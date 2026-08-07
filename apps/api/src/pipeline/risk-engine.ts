import type { Action, Quote, RiskFeatures, RiskVerdict, VaultState } from "@candor/shared";
import { judgeRiskWithClaude } from "./agent-llm.js";
import { resolveAddress } from "../integrations/token-registry.js";

// Rule-engine thresholds. Deliberately conservative and documented, since
// these are the hard safety floor even when the LLM is unavailable.
const SAFE_IMPACT_BPS = 100; // 1%
const SAFE_SIZE_USD = 1_000;
const SAFE_UTILIZATION_BPS = 8_000; // 80%
const HARD_REJECT_IMPACT_BPS = 2_000; // 20%
const HARD_REJECT_UTILIZATION_BPS = 9_800; // 98%

const STABLECOINS = new Set(["USDT", "USDC", "DAI", "DUSDT"]);

/** Very rough USD sizing for the hackathon demo: treat stablecoin amounts as
 *  ~1:1 USD, everything else as unpriced (0) rather than guessing a rate we
 *  don't actually have. Swap in a real price feed before relying on this for
 *  anything beyond a demo. */
async function estimateUsdSize(tokenAddress: string, amountWei: string): Promise<number> {
  // Decimals MUST come from the registry entry for this exact token, never a
  // caller-supplied guess — using the wrong decimals here silently produces
  // a wildly wrong size estimate (e.g. off by 10^12), which would in turn
  // make the rule engine misjudge risk. resolveAddress is the single source
  // of truth for both "is this a stablecoin" and "how many decimals".
  const registryHit = await resolveAddress(tokenAddress).catch(() => null);
  if (registryHit && STABLECOINS.has(registryHit.symbol)) {
    return Number(amountWei) / 10 ** registryHit.decimals;
  }
  return 0;
}

export async function computeSwapRiskFeatures(params: {
  fromTokenAddress: string;
  amountWei: string;
  quote: Quote;
}): Promise<RiskFeatures> {
  const requestedSizeUsd = await estimateUsdSize(params.fromTokenAddress, params.amountWei);
  return {
    priceImpactBps: params.quote.priceImpactBps,
    liquidityDepthUsd: params.quote.liquidityDepthUsd,
    requestedSizeUsd,
    // OKX's basic quote endpoint doesn't expose order-book depth directly;
    // price impact is itself the honest proxy for size-vs-liquidity here.
    sizeToLiquidityBps: params.quote.priceImpactBps,
  };
}

export function computeVaultDepositRiskFeatures(params: {
  amountHuman: number;
  vaultState: VaultState;
}): RiskFeatures {
  const cap = params.vaultState.capWei ? Number(params.vaultState.capWei) : 0;
  const totalAssets = Number(params.vaultState.totalAssetsWei);
  const sizeToLiquidityBps = cap > 0 ? Math.min(10_000, Math.round(((totalAssets + params.amountHuman) / cap) * 10_000)) : 0;

  return {
    priceImpactBps: 0,
    liquidityDepthUsd: 0,
    requestedSizeUsd: params.amountHuman,
    sizeToLiquidityBps,
    poolUtilizationBps: params.vaultState.utilizationBps,
  };
}

/** Deterministic pass. Returns a verdict only for the clear-cut cases (either
 *  clearly safe, or a hard-floor rejection) — everything in between returns
 *  `null` so the pipeline escalates to Claude for a reasoned judgment. */
export function ruleVerdict(features: RiskFeatures): RiskVerdict | null {
  if (features.priceImpactBps >= HARD_REJECT_IMPACT_BPS) {
    return {
      verdict: "REJECT",
      riskScore: 95,
      rationale: `Price impact of ${(features.priceImpactBps / 100).toFixed(1)}% is far outside safe bounds — rejecting automatically regardless of size.`,
      suggestedAmountWei: null,
      source: "rule",
      features,
    };
  }

  if ((features.poolUtilizationBps ?? 0) >= HARD_REJECT_UTILIZATION_BPS) {
    return {
      verdict: "REJECT",
      riskScore: 92,
      rationale: `This pool is at ${(features.poolUtilizationBps! / 100).toFixed(0)}% utilization — too close to capacity to safely accept more deposits.`,
      suggestedAmountWei: null,
      source: "rule",
      features,
    };
  }

  const clearlySafe =
    features.priceImpactBps <= SAFE_IMPACT_BPS &&
    features.requestedSizeUsd <= SAFE_SIZE_USD &&
    (features.poolUtilizationBps ?? 0) <= SAFE_UTILIZATION_BPS;

  if (clearlySafe) {
    const riskScore = Math.min(
      35,
      Math.round(features.priceImpactBps / 5 + features.requestedSizeUsd / 200)
    );
    return {
      verdict: "EXECUTE",
      riskScore,
      rationale: `Small size ($${features.requestedSizeUsd.toFixed(0)}) and low price impact (${(features.priceImpactBps / 100).toFixed(2)}%) — within safe bounds, no further review needed.`,
      suggestedAmountWei: null,
      source: "rule",
      features,
    };
  }

  return null; // borderline — escalate to the LLM
}

export async function computeVerdict(
  features: RiskFeatures,
  context: { action: Action; userMessage: string; requestedAmountWei: string }
): Promise<RiskVerdict> {
  const fast = ruleVerdict(features);
  if (fast) return fast;

  const actionSummary =
    context.action.type === "swap"
      ? `swap ${context.action.params.amountWei} wei from ${context.action.params.fromToken} to ${context.action.params.toToken}`
      : `deposit ${context.action.params.amountWei} wei of ${context.action.params.assetToken} into vault ${context.action.params.vaultAddress}`;

  const llm = await judgeRiskWithClaude(features, { actionSummary, userMessage: context.userMessage });

  const suggestedAmountWei =
    llm.verdict === "EXECUTE_SMALLER" && llm.suggestedFraction !== null
      ? ((BigInt(context.requestedAmountWei) * BigInt(Math.round(llm.suggestedFraction * 10_000))) / 10_000n).toString()
      : null;

  return {
    verdict: llm.verdict,
    riskScore: llm.riskScore,
    rationale: llm.rationale,
    suggestedAmountWei,
    source: "llm",
    features,
  };
}
