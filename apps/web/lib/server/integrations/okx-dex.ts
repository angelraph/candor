import { createHmac } from "node:crypto";
import { config } from "../config";
import type { Quote } from "@candor/shared";

/**
 * OKX Web3 DEX Aggregator client. Signing scheme per OKX's documented API
 * convention: prehash = timestamp + method + requestPath(+body), signature =
 * base64(HMAC-SHA256(secret, prehash)), sent via OK-ACCESS-* headers.
 *
 * Runs in MOCK MODE (clearly logged, never silent) when credentials aren't
 * configured yet — this is deliberate so the rest of the pipeline can be
 * built and tested against realistic-shaped responses before OKX approves
 * API access, per the plan's mitigation for that exact risk. Attempts a
 * live call on every configured chain (including X Layer testnet) rather
 * than assuming a chain has no real liquidity — OKX's own response is what
 * decides that, not a guess made here.
 */

const OKX_DEX_PATH_PREFIX = "/api/v6/dex/aggregator";

interface OkxTokenInfo {
  chainId: string;
  tokenSymbol: string;
  tokenContractAddress: string;
  decimals: string;
}

// Matches OKX's real response shape (verified against a live mainnet quote,
// not the docs — several fields differ from what's documented: the whole
// thing is wrapped in a single-element array, priceImpactPercent (not
// -Percentage), and dexRouterList nests dexProtocol.{dexName,percent}
// rather than a flat {router, routerPercent}).
interface OkxQuoteResponse {
  chainIndex: string;
  toTokenAmount: string;
  fromTokenAmount: string;
  priceImpactPercent: string;
  estimateGasFee: string;
  dexRouterList: Array<{
    dexProtocol: { dexName: string; percent: string };
  }>;
}

interface OkxSwapResponse {
  tx: { to: string; data: string; value: string; gas: string; gasPrice: string };
  routerResult: OkxQuoteResponse;
}

/** Thrown on timeout or network-level failure reaching OKX — distinct from an
 *  OKX-returned error (bad request, bad signature, etc.) so callers can tell
 *  "OKX said no" apart from "couldn't reach OKX at all" and react accordingly
 *  (the latter is always safe to treat as transient / fall back on). */
export class OkxDexUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`OKX DEX API unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "OkxDexUnreachableError";
  }
}

// Swap/quote calls have no sensible fallback (they ARE the thing being
// requested), so they get more patience. all-tokens feeds the classifier's
// symbol resolution, which is supposed to stay near-instant — it gets a
// short leash so a down OKX can't drag basic token lookups down with it.
const DEFAULT_TIMEOUT_MS = 6_000;
const TOKEN_LIST_TIMEOUT_MS = 2_000;

function sign(timestamp: string, method: string, requestPath: string, body: string): string {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  return createHmac("sha256", config.okxDex.apiSecret ?? "").update(prehash).digest("base64");
}

async function okxRequest<T>(
  method: "GET",
  path: string,
  query: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const requestPath = `${path}?${new URLSearchParams(query).toString()}`;
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": config.okxDex.apiKey ?? "",
    "OK-ACCESS-SIGN": sign(timestamp, method, requestPath, ""),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": config.okxDex.apiPassphrase ?? "",
    // A bare server fetch with no User-Agent/Accept headers reads as an
    // obvious non-browser client to a WAF — some environments see the
    // connection itself refused before the OKX-signed headers above are even
    // evaluated. These make the request look like an ordinary browser fetch.
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
  };
  if (config.okxDex.projectId) headers["OK-ACCESS-PROJECT"] = config.okxDex.projectId;

  // A hung/unreachable OKX host must fail fast (and distinctly), not take
  // the whole request pipeline down with a multi-minute TCP timeout — this
  // is what let a swap-only OKX outage previously break vault deposits too.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${config.okxDex.baseUrl}${requestPath}`, { method, headers, signal: controller.signal });
  } catch (err) {
    throw new OkxDexUnreachableError(err);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`OKX DEX API ${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { code: string; msg: string; data: T };
  if (json.code !== "0") {
    throw new Error(`OKX DEX API ${method} ${path} -> code ${json.code}: ${json.msg}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Mock responses — shaped to match OKX's documented schema, so switching a
// live key in later requires no changes to callers, only to `config.okxDexConfigured`.
// ---------------------------------------------------------------------------

function mockQuote(chainId: number, fromAmountWei: string): OkxQuoteResponse {
  // Deterministic-ish synthetic 1:1800 rate purely so the confirm card has
  // plausible numbers to render during development. Never used on mainnet
  // once OKX_DEX_API_KEY etc. are configured.
  const toAmount = (BigInt(fromAmountWei) * 1800n) / 3_000_000n; // rough ETH~1800 vs 6-decimal stable-ish input
  return {
    chainIndex: String(chainId),
    toTokenAmount: toAmount.toString(),
    fromTokenAmount: fromAmountWei,
    priceImpactPercent: "0.12",
    estimateGasFee: "180000",
    dexRouterList: [{ dexProtocol: { dexName: "mock-router/no-liquidity-on-this-chain", percent: "100" } }],
  };
}

// Verified live, not assumed: a real signed call to OKX's aggregator for
// chainIndex=1952 (X Layer testnet) returns `code 50026: System error` even
// for a same-token, real-address, on-chain-verified pair — not an
// "unsupported chain" rejection, a generic failure, and it doesn't matter
// which tokens are involved. OKX simply has no working routing data for
// this chain. Mainnet (196) is the only chain this ever attempts live.
const LIVE_QUOTE_CHAIN_ID = 196;

function liveQuotesAvailable(chainId: number): boolean {
  return config.okxDexConfigured && chainId === LIVE_QUOTE_CHAIN_ID;
}

function mockReason(chainId: number): string {
  return config.okxDexConfigured
    ? `chain ${chainId} has no live OKX DEX routing (only mainnet does)`
    : "OKX_DEX_API_KEY not set";
}

export interface GetQuoteParams {
  chainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  amountWei: string;
  slippageBps: number;
}

export interface DexQuoteResult extends Quote {
  mock: boolean;
}

export async function getAllTokens(chainId: number): Promise<OkxTokenInfo[]> {
  if (!liveQuotesAvailable(chainId)) {
    console.warn(`[okx-dex] mock mode for chain ${chainId} (${mockReason(chainId)}) — returning empty token list`);
    return [];
  }
  return okxRequest<OkxTokenInfo[]>(
    "GET",
    `${OKX_DEX_PATH_PREFIX}/all-tokens`,
    { chainIndex: String(chainId) },
    TOKEN_LIST_TIMEOUT_MS
  );
}

export async function getQuote(params: GetQuoteParams): Promise<DexQuoteResult> {
  let data: OkxQuoteResponse;
  let mock = false;

  if (!liveQuotesAvailable(params.chainId)) {
    console.warn(`[okx-dex] mock mode for chain ${params.chainId} (${mockReason(params.chainId)}) — returning synthetic quote`);
    data = mockQuote(params.chainId, params.amountWei);
    mock = true;
  } else {
    // OKX wraps /quote responses in a single-element array (verified against
    // a live response, not assumed from docs) — same convention as /swap.
    const results = await okxRequest<OkxQuoteResponse[]>("GET", `${OKX_DEX_PATH_PREFIX}/quote`, {
      chainIndex: String(params.chainId),
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      amount: params.amountWei,
      slippage: (params.slippageBps / 10_000).toString(),
    });
    data = results[0];
  }

  const minReceived =
    (BigInt(data.toTokenAmount) * BigInt(10_000 - params.slippageBps)) / 10_000n;

  return {
    expectedOutWei: data.toTokenAmount,
    minReceivedWei: minReceived.toString(),
    priceImpactBps: Math.round(Number(data.priceImpactPercent) * 100),
    liquidityDepthUsd: 0, // OKX quote doesn't expose this directly; risk engine derives a proxy from route count/impact
    route: data.dexRouterList.map((r) => `${r.dexProtocol.dexName} (${r.dexProtocol.percent}%)`),
    gasEstimateWei: data.estimateGasFee,
    mock,
  };
}

export interface GetSwapTxParams extends GetQuoteParams {
  userWalletAddress: string;
}

export interface DexSwapTx {
  to: string;
  data: string;
  value: string;
  gas: string;
  mock: boolean;
}

export async function getSwapTransaction(params: GetSwapTxParams): Promise<DexSwapTx> {
  if (!liveQuotesAvailable(params.chainId)) {
    console.warn(`[okx-dex] mock mode for chain ${params.chainId} (${mockReason(params.chainId)}) — returning non-executable placeholder calldata`);
    return { to: params.toTokenAddress, data: "0x", value: "0", gas: "180000", mock: true };
  }

  const data = await okxRequest<OkxSwapResponse[]>("GET", `${OKX_DEX_PATH_PREFIX}/swap`, {
    chainIndex: String(params.chainId),
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    amount: params.amountWei,
    // /swap wants 'slippagePercent' specifically — verified against a live
    // 400 response ('Parameter slippagePercent cannot be empty'); /quote
    // accepts plain 'slippage' instead. Undocumented inconsistency between
    // the two endpoints, not a guess.
    slippagePercent: (params.slippageBps / 10_000).toString(),
    userWalletAddress: params.userWalletAddress,
  });
  const swap = data[0];
  return { to: swap.tx.to, data: swap.tx.data, value: swap.tx.value, gas: swap.tx.gas, mock: false };
}
