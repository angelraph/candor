import { createHmac } from "node:crypto";
import { config } from "../config.js";
import type { Quote } from "@candor/shared";

/**
 * OKX Web3 DEX Aggregator client. Signing scheme per OKX's documented API
 * convention: prehash = timestamp + method + requestPath(+body), signature =
 * base64(HMAC-SHA256(secret, prehash)), sent via OK-ACCESS-* headers.
 *
 * Runs in MOCK MODE (clearly logged, never silent) when credentials aren't
 * configured yet — this is deliberate so the rest of the pipeline can be
 * built and tested against realistic-shaped responses before OKX approves
 * API access, per the plan's mitigation for that exact risk.
 */

const OKX_DEX_PATH_PREFIX = "/api/v6/dex/aggregator";

interface OkxTokenInfo {
  chainId: string;
  tokenSymbol: string;
  tokenContractAddress: string;
  decimals: string;
}

interface OkxQuoteResponse {
  chainId: string;
  toTokenAmount: string;
  fromTokenAmount: string;
  priceImpactPercentage: string;
  estimateGasFee: string;
  dexRouterList: Array<{ router: string; routerPercent: string }>;
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

function mockQuote(fromAmountWei: string): OkxQuoteResponse {
  // Deterministic-ish synthetic 1:1800 rate purely so the confirm card has
  // plausible numbers to render during development. Never used once
  // OKX_DEX_API_KEY etc. are configured.
  const toAmount = (BigInt(fromAmountWei) * 1800n) / 3_000_000n; // rough ETH~1800 vs 6-decimal stable-ish input
  return {
    chainId: String(config.chainId),
    toTokenAmount: toAmount.toString(),
    fromTokenAmount: fromAmountWei,
    priceImpactPercentage: "0.12",
    estimateGasFee: "180000",
    dexRouterList: [{ router: "mock-router/no-key-configured", routerPercent: "100" }],
  };
}

export interface GetQuoteParams {
  fromTokenAddress: string;
  toTokenAddress: string;
  amountWei: string;
  slippageBps: number;
}

export interface DexQuoteResult extends Quote {
  mock: boolean;
}

export async function getAllTokens(): Promise<OkxTokenInfo[]> {
  if (!config.okxDexConfigured) {
    console.warn("[okx-dex] mock mode — OKX_DEX_API_KEY not set, returning empty token list");
    return [];
  }
  return okxRequest<OkxTokenInfo[]>(
    "GET",
    `${OKX_DEX_PATH_PREFIX}/all-tokens`,
    { chainId: String(config.chainId) },
    TOKEN_LIST_TIMEOUT_MS
  );
}

export async function getQuote(params: GetQuoteParams): Promise<DexQuoteResult> {
  let data: OkxQuoteResponse;
  let mock = false;

  if (!config.okxDexConfigured) {
    console.warn("[okx-dex] mock mode — OKX_DEX_API_KEY not set, returning synthetic quote");
    data = mockQuote(params.amountWei);
    mock = true;
  } else {
    data = await okxRequest<OkxQuoteResponse>("GET", `${OKX_DEX_PATH_PREFIX}/quote`, {
      chainId: String(config.chainId),
      fromTokenAddress: params.fromTokenAddress,
      toTokenAddress: params.toTokenAddress,
      amount: params.amountWei,
      slippage: (params.slippageBps / 10_000).toString(),
    });
  }

  const minReceived =
    (BigInt(data.toTokenAmount) * BigInt(10_000 - params.slippageBps)) / 10_000n;

  return {
    expectedOutWei: data.toTokenAmount,
    minReceivedWei: minReceived.toString(),
    priceImpactBps: Math.round(Number(data.priceImpactPercentage) * 100),
    liquidityDepthUsd: 0, // OKX quote doesn't expose this directly; risk engine derives a proxy from route count/impact
    route: data.dexRouterList.map((r) => `${r.router} (${r.routerPercent}%)`),
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
  if (!config.okxDexConfigured) {
    console.warn("[okx-dex] mock mode — OKX_DEX_API_KEY not set, returning non-executable placeholder calldata");
    return { to: params.toTokenAddress, data: "0x", value: "0", gas: "180000", mock: true };
  }

  const data = await okxRequest<OkxSwapResponse[]>("GET", `${OKX_DEX_PATH_PREFIX}/swap`, {
    chainId: String(config.chainId),
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    amount: params.amountWei,
    slippage: (params.slippageBps / 10_000).toString(),
    userWalletAddress: params.userWalletAddress,
  });
  const swap = data[0];
  return { to: swap.tx.to, data: swap.tx.data, value: swap.tx.value, gas: swap.tx.gas, mock: false };
}

/** Whether the caller's ERC-20 allowance needs an /approve-transaction step
 *  before the swap can execute — checked on-chain by the pipeline via viem,
 *  not this client; this just builds the approval calldata when needed. */
export async function getApproveTransaction(params: {
  tokenContractAddress: string;
  approveAmountWei: string;
}): Promise<{ to: string; data: string } | null> {
  if (!config.okxDexConfigured) {
    console.warn("[okx-dex] mock mode — skipping approve-transaction, no key configured");
    return null;
  }
  return okxRequest<{ to: string; data: string }>("GET", `${OKX_DEX_PATH_PREFIX}/approve-transaction`, {
    chainId: String(config.chainId),
    tokenContractAddress: params.tokenContractAddress,
    approveAmount: params.approveAmountWei,
  });
}
