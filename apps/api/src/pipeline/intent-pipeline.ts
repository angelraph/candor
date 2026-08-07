import { parseUnits, type Hex } from "viem";
import type { Action, ConfirmCard, IntentRequest, RiskVerdict } from "@candor/shared";
import { config } from "../config.js";
import { classifyFastPath, type FastPathIntent } from "./classifier.js";
import { parseIntentWithClaude } from "./agent-llm.js";
import { computeSwapRiskFeatures, computeVaultDepositRiskFeatures, computeVerdict } from "./risk-engine.js";
import { simulateSwap, simulateVaultDeposit, type PreparedTx } from "./simulate.js";
import { readVaultState, VaultNotConfiguredError } from "../integrations/vault.js";
import { resolveSymbol, resolveAddress } from "../integrations/token-registry.js";
import { getBalance } from "../integrations/erc20.js";
import { computeEvidenceHash, computeIntentHash } from "../utils/hash.js";
import { Stopwatch } from "../utils/latency.js";
import { putConfirmCard, consumeConfirmCard } from "./confirm-card-store.js";
import { anchorVerdict, getLedgerStatus } from "../integrations/ledger.js";

const CONFIRM_CARD_TTL_MS = 20_000; // stale-quote guard — re-quote if the user takes longer than this to confirm

export class UnsupportedIntentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedIntentError";
  }
}

// ---------------------------------------------------------------------------
// Step 1: classify — fast path first, Claude only if it returns null.
// ---------------------------------------------------------------------------

async function resolveAction(
  message: string,
  userAddress: Hex,
  stopwatch: Stopwatch
): Promise<{ action: Action; requestedAmountWei: string }> {
  const fast = await stopwatch.time("classify", () => classifyFastPath(message));
  if (fast) return resolveFromFastPath(fast, userAddress);

  const parsed = await parseIntentWithClaude(message);
  if (parsed.type === "unsupported") throw new UnsupportedIntentError(parsed.reason);

  if (parsed.type === "swap") {
    const [from, to] = await Promise.all([
      resolveSymbol(parsed.fromTokenSymbol),
      resolveSymbol(parsed.toTokenSymbol),
    ]);
    if (!from) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.fromTokenSymbol}`);
    if (!to) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.toTokenSymbol}`);

    const amountWei =
      parsed.amountHuman === "full_balance"
        ? (await getBalance(from.address as Hex, userAddress)).toString()
        : parseUnits(parsed.amountHuman, from.decimals).toString();

    return {
      action: { type: "swap", params: { fromToken: from.address, toToken: to.address, amountWei, slippageBps: 50 } },
      requestedAmountWei: amountWei,
    };
  }

  // vault_deposit
  const token = await resolveSymbol(parsed.assetTokenSymbol);
  if (!token) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.assetTokenSymbol}`);
  if (!config.contracts.rwaVault) throw new VaultNotConfiguredError();

  const amountWei =
    parsed.amountHuman === "full_balance"
      ? (await getBalance(token.address as Hex, userAddress)).toString()
      : parseUnits(parsed.amountHuman, token.decimals).toString();

  return {
    action: {
      type: "vault_deposit",
      params: { vaultAddress: config.contracts.rwaVault, assetToken: token.address, amountWei },
    },
    requestedAmountWei: amountWei,
  };
}

async function resolveFromFastPath(
  fast: FastPathIntent,
  userAddress: Hex
): Promise<{ action: Action; requestedAmountWei: string }> {
  if (fast.type === "swap") {
    const amountWei =
      fast.amount.kind === "full_balance"
        ? (await getBalance(fast.fromToken as Hex, userAddress)).toString()
        : fast.amount.wei;
    return {
      action: {
        type: "swap",
        params: { fromToken: fast.fromToken, toToken: fast.toToken, amountWei, slippageBps: fast.slippageBps },
      },
      requestedAmountWei: amountWei,
    };
  }

  if (!config.contracts.rwaVault) throw new VaultNotConfiguredError();
  const amountWei =
    fast.amount.kind === "full_balance"
      ? (await getBalance(fast.assetToken as Hex, userAddress)).toString()
      : fast.amount.wei;
  return {
    action: {
      type: "vault_deposit",
      params: { vaultAddress: config.contracts.rwaVault, assetToken: fast.assetToken, amountWei },
    },
    requestedAmountWei: amountWei,
  };
}

// ---------------------------------------------------------------------------
// Step 2: quote/simulate + risk verdict, then assemble the ConfirmCard.
// ---------------------------------------------------------------------------

export async function processIntent(req: IntentRequest): Promise<ConfirmCard> {
  const stopwatch = new Stopwatch();
  const userAddress = req.userAddress as Hex;

  const { action, requestedAmountWei } = await resolveAction(req.message, userAddress, stopwatch);

  let quote: ConfirmCard["quote"] = null;
  let vaultState: ConfirmCard["vaultState"] = null;
  let tx: PreparedTx | null = null;
  let verdict: RiskVerdict;

  if (action.type === "swap") {
    const sim = await stopwatch.time("quote", () =>
      simulateSwap({
        fromToken: action.params.fromToken as Hex,
        toToken: action.params.toToken as Hex,
        amountWei: action.params.amountWei,
        slippageBps: action.params.slippageBps,
        userAddress,
      })
    );
    quote = sim.quote;
    tx = sim.tx;

    const features = await computeSwapRiskFeatures({
      fromTokenAddress: action.params.fromToken,
      amountWei: action.params.amountWei,
      quote: sim.quote,
    });
    verdict = await stopwatch.time("verdict", () =>
      computeVerdict(features, { action, userMessage: req.message, requestedAmountWei })
    );
  } else {
    const state = await stopwatch.time("quote", () => readVaultState());
    vaultState = state;
    tx = (
      await stopwatch.time("simulate", () =>
        simulateVaultDeposit({
          vaultAddress: action.params.vaultAddress as Hex,
          amountWei: action.params.amountWei,
          userAddress,
        })
      )
    ).tx;

    // Resolve the asset's real decimals from the registry rather than
    // assuming 6 — same class of bug as the swap path's USD sizing, fixed
    // the same way: never hardcode a token's decimals.
    const assetInfo = await resolveAddress(action.params.assetToken);
    const assetDecimals = assetInfo?.decimals ?? 6;
    const features = computeVaultDepositRiskFeatures({
      amountHuman: Number(action.params.amountWei) / 10 ** assetDecimals,
      vaultState: state,
    });
    verdict = await stopwatch.time("verdict", () =>
      computeVerdict(features, { action, userMessage: req.message, requestedAmountWei })
    );
  }

  const now = Date.now();
  const confirmCard: ConfirmCard = {
    action,
    quote,
    vaultState,
    verdict,
    latency: stopwatch.breakdown(),
    intentHash: computeIntentHash({ userAddress, chainId: req.chainId, action, nonce: now }),
    evidenceHash: computeEvidenceHash(verdict),
    preparedAt: now,
    expiresAt: now + CONFIRM_CARD_TTL_MS,
  };

  putConfirmCard(confirmCard.intentHash, { confirmCard, tx: verdict.verdict === "REJECT" ? null : tx, userAddress });

  return confirmCard;
}

// ---------------------------------------------------------------------------
// Step 3: finalize — called once the user acts on the confirm card. Anchors
// the verdict to ReasoningLedger with the correct `overrode` flag (only now
// knowable) and, for confirm/override, returns the prepared tx for signing.
// ---------------------------------------------------------------------------

export type FinalizeDecision = "confirm" | "override" | "dismiss";

export class ConfirmCardExpiredError extends Error {
  constructor() {
    super("This confirm card has expired or was already finalized — request a fresh quote");
    this.name = "ConfirmCardExpiredError";
  }
}

export function finalizeIntent(intentHash: string, decision: FinalizeDecision): { tx: PreparedTx | null } {
  const entry = consumeConfirmCard(intentHash);
  if (!entry) throw new ConfirmCardExpiredError();

  const overrode = decision === "override" && entry.confirmCard.verdict.verdict !== "EXECUTE";

  anchorVerdict({
    intentHash: entry.confirmCard.intentHash as Hex,
    evidenceHash: entry.confirmCard.evidenceHash as Hex,
    verdict: entry.confirmCard.verdict.verdict,
    riskScore: entry.confirmCard.verdict.riskScore,
    overrode,
    userAddress: entry.userAddress as Hex,
  });

  if (decision === "dismiss") return { tx: null };
  return { tx: entry.tx };
}

export function ledgerStatus(intentHash: string) {
  return getLedgerStatus(intentHash);
}
