import { parseUnits, type Hex } from "viem";
import type { Action, ConfirmCard, IntentRequest, RiskVerdict } from "@candor/shared";
import { config } from "../config";
import { classifyFastPath, type FastPathIntent } from "./classifier";
import { parseIntentWithClaude } from "./agent-llm";
import { computeSwapRiskFeatures, computeVaultDepositRiskFeatures, computeVerdict } from "./risk-engine";
import { simulateSwap, simulateVaultDeposit, type PreparedTx } from "./simulate";
import { readVaultState, VaultNotConfiguredError } from "../integrations/vault";
import { resolveSymbol, resolveAddress } from "../integrations/token-registry";
import { getBalance } from "../integrations/erc20";
import { computeEvidenceHash, computeIntentHash } from "../utils/hash";
import { Stopwatch } from "../utils/latency";
import { signConfirmToken, verifyConfirmToken, ConfirmCardExpiredError } from "./confirm-token";
import { anchorVerdict } from "../integrations/ledger";

export { ConfirmCardExpiredError };

// Stale-quote guard: re-quote if the user takes longer than this to confirm.
// 20s was too tight in practice — it only leaves time to glance at the card,
// not to actually read the risk rationale and decide. A minute gives a real
// user room to read and click without the card dying under them; it's still
// short enough to catch a genuinely stale swap price, and vault deposits
// (fixed-APR, no slippage) don't need a tight window at all.
const CONFIRM_CARD_TTL_MS = 60_000;

export class UnsupportedIntentError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedIntentError";
  }
}

// ---------------------------------------------------------------------------
// Step 1: classify — fast path first, LLM only if it returns null.
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
  const intentHash = computeIntentHash({ userAddress, chainId: req.chainId, action, nonce: now });
  const evidenceHash = computeEvidenceHash(verdict);
  const expiresAt = now + CONFIRM_CARD_TTL_MS;
  const preparedTx = verdict.verdict === "REJECT" ? null : tx;

  const token = signConfirmToken({
    intentHash,
    evidenceHash,
    verdictType: verdict.verdict,
    riskScore: verdict.riskScore,
    userAddress,
    tx: preparedTx,
    expiresAt,
  });

  return {
    action,
    quote,
    vaultState,
    verdict,
    latency: stopwatch.breakdown(),
    intentHash,
    evidenceHash,
    preparedAt: now,
    expiresAt,
    token,
  };
}

// ---------------------------------------------------------------------------
// Step 3: finalize — called once the user acts on the confirm card. Anchors
// the verdict to ReasoningLedger with the correct `overrode` flag (only now
// knowable) and, for confirm/override, returns the prepared tx for signing.
// The card's state comes from the signed token, not server-side storage —
// see confirm-token.ts for why.
// ---------------------------------------------------------------------------

export type FinalizeDecision = "confirm" | "override" | "dismiss";

export async function finalizeIntent(
  intentHash: string,
  decision: FinalizeDecision,
  token: string
): Promise<{ tx: PreparedTx | null; ledgerTxHash: Hex | null }> {
  const payload = verifyConfirmToken(token);
  if (payload.intentHash !== intentHash) throw new ConfirmCardExpiredError();

  const overrode = decision === "override" && payload.verdictType !== "EXECUTE";

  const ledgerTxHash = await anchorVerdict({
    intentHash: payload.intentHash as Hex,
    evidenceHash: payload.evidenceHash as Hex,
    verdict: payload.verdictType,
    riskScore: payload.riskScore,
    overrode,
    userAddress: payload.userAddress as Hex,
  }).catch((err) => {
    console.error(`[ledger] failed to anchor verdict for ${payload.intentHash}:`, err);
    return null;
  });

  if (decision === "dismiss") return { tx: null, ledgerTxHash };
  return { tx: payload.tx, ledgerTxHash };
}
