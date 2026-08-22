import { parseUnits, type Hex } from "viem";
import type { Action, ConfirmCard, IntentRequest, RiskVerdict } from "@candor/shared";
import { config, getChainConfig } from "../config";
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

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Chain ${chainId} is not supported — use X Layer mainnet (196) or testnet (1952)`);
    this.name = "UnsupportedChainError";
  }
}

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
  chainId: number,
  message: string,
  userAddress: Hex,
  stopwatch: Stopwatch
): Promise<{ action: Action; requestedAmountWei: string }> {
  const fast = await stopwatch.time("classify", () => classifyFastPath(chainId, message));
  if (fast) return resolveFromFastPath(chainId, fast, userAddress);

  const parsed = await parseIntentWithClaude(message);
  if (parsed.type === "unsupported") throw new UnsupportedIntentError(parsed.reason);

  if (parsed.type === "swap") {
    const [from, to] = await Promise.all([
      resolveSymbol(chainId, parsed.fromTokenSymbol),
      resolveSymbol(chainId, parsed.toTokenSymbol),
    ]);
    if (!from) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.fromTokenSymbol}`);
    if (!to) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.toTokenSymbol}`);

    const amountWei =
      parsed.amountHuman === "full_balance"
        ? (await getBalance(chainId, from.address as Hex, userAddress)).toString()
        : parseUnits(parsed.amountHuman, from.decimals).toString();

    return {
      action: { type: "swap", params: { fromToken: from.address, toToken: to.address, amountWei, slippageBps: 50 } },
      requestedAmountWei: amountWei,
    };
  }

  // vault_deposit
  const token = await resolveSymbol(chainId, parsed.assetTokenSymbol);
  if (!token) throw new UnsupportedIntentError(`Unrecognized token symbol: ${parsed.assetTokenSymbol}`);
  const rwaVault = getChainConfig(chainId).contracts.rwaVault;
  if (!rwaVault) throw new VaultNotConfiguredError();

  const amountWei =
    parsed.amountHuman === "full_balance"
      ? (await getBalance(chainId, token.address as Hex, userAddress)).toString()
      : parseUnits(parsed.amountHuman, token.decimals).toString();

  return {
    action: {
      type: "vault_deposit",
      params: { vaultAddress: rwaVault, assetToken: token.address, amountWei },
    },
    requestedAmountWei: amountWei,
  };
}

async function resolveFromFastPath(
  chainId: number,
  fast: FastPathIntent,
  userAddress: Hex
): Promise<{ action: Action; requestedAmountWei: string }> {
  if (fast.type === "swap") {
    const amountWei =
      fast.amount.kind === "full_balance"
        ? (await getBalance(chainId, fast.fromToken as Hex, userAddress)).toString()
        : fast.amount.wei;
    return {
      action: {
        type: "swap",
        params: { fromToken: fast.fromToken, toToken: fast.toToken, amountWei, slippageBps: fast.slippageBps },
      },
      requestedAmountWei: amountWei,
    };
  }

  const rwaVault = getChainConfig(chainId).contracts.rwaVault;
  if (!rwaVault) throw new VaultNotConfiguredError();
  const amountWei =
    fast.amount.kind === "full_balance"
      ? (await getBalance(chainId, fast.assetToken as Hex, userAddress)).toString()
      : fast.amount.wei;
  return {
    action: {
      type: "vault_deposit",
      params: { vaultAddress: rwaVault, assetToken: fast.assetToken, amountWei },
    },
    requestedAmountWei: amountWei,
  };
}

// ---------------------------------------------------------------------------
// Step 2: quote/simulate + risk verdict, then assemble the ConfirmCard.
// ---------------------------------------------------------------------------

export async function processIntent(req: IntentRequest): Promise<ConfirmCard> {
  if (!config.isSupportedChain(req.chainId)) throw new UnsupportedChainError(req.chainId);

  const stopwatch = new Stopwatch();
  const userAddress = req.userAddress as Hex;
  const chainId = req.chainId;

  const { action, requestedAmountWei } = await resolveAction(chainId, req.message, userAddress, stopwatch);

  let quote: ConfirmCard["quote"] = null;
  let vaultState: ConfirmCard["vaultState"] = null;
  let tx: PreparedTx | null = null;
  let verdict: RiskVerdict;

  if (action.type === "swap") {
    const sim = await stopwatch.time("quote", () =>
      simulateSwap({
        chainId,
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
      chainId,
      fromTokenAddress: action.params.fromToken,
      amountWei: action.params.amountWei,
      quote: sim.quote,
    });
    verdict = await stopwatch.time("verdict", () =>
      computeVerdict(features, { action, userMessage: req.message, requestedAmountWei })
    );
  } else {
    const state = await stopwatch.time("quote", () => readVaultState(chainId));
    vaultState = state;
    tx = (
      await stopwatch.time("simulate", () =>
        simulateVaultDeposit({
          chainId,
          vaultAddress: action.params.vaultAddress as Hex,
          amountWei: action.params.amountWei,
          userAddress,
        })
      )
    ).tx;

    // Resolve the asset's real decimals from the registry rather than
    // assuming 6 — same class of bug as the swap path's USD sizing, fixed
    // the same way: never hardcode a token's decimals.
    const assetInfo = await resolveAddress(chainId, action.params.assetToken);
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
  const intentHash = computeIntentHash({ userAddress, chainId, action, nonce: now });
  const evidenceHash = computeEvidenceHash(verdict);
  const expiresAt = now + CONFIRM_CARD_TTL_MS;
  // A mocked swap quote (no live DEX routing on this chain) has no real
  // route to execute — its "tx" is a zero-value, empty-calldata send to the
  // target token's own address, which is meaningless on-chain and reads as
  // exactly the kind of pattern wallet security scanners are built to
  // block (verified live: OKX Wallet refused to sign it outright on
  // testnet). Treat it the same as a REJECT verdict: anchor Candor's
  // verdict, never hand the wallet something to sign.
  const preparedTx = verdict.verdict === "REJECT" || quote?.mock ? null : tx;

  const token = signConfirmToken({
    chainId,
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
    chainId,
    token,
  };
}

// ---------------------------------------------------------------------------
// Step 3: finalize — called once the user acts on the confirm card. Anchors
// the verdict to ReasoningLedger with the correct `overrode` flag (only now
// knowable) and, for confirm/override, returns the prepared tx for signing.
// The card's state (including which chain it's for) comes from the signed
// token, not server-side storage — see confirm-token.ts for why.
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
    chainId: payload.chainId,
    intentHash: payload.intentHash as Hex,
    evidenceHash: payload.evidenceHash as Hex,
    verdict: payload.verdictType,
    riskScore: payload.riskScore,
    overrode,
    userAddress: payload.userAddress as Hex,
  }).catch((err) => {
    console.error(`[ledger] failed to anchor verdict for ${payload.intentHash} on chain ${payload.chainId}:`, err);
    return null;
  });

  if (decision === "dismiss") return { tx: null, ledgerTxHash };
  return { tx: payload.tx, ledgerTxHash };
}
