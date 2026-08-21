import type { Hex } from "viem";
import { config, getChainConfig } from "../config";
import { getAllTokens, OkxDexUnreachableError } from "./okx-dex";
import { getTokenMetadata } from "./erc20";

export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

/** Obviously-fake placeholder addresses (incrementing from 0x...01), used only
 *  when OKX_DEX_API_KEY isn't configured yet, so the classifier/pipeline can
 *  be exercised end-to-end in dev. Never resembles a real deployed address. */
const MOCK_TOKENS: TokenInfo[] = [
  { symbol: "USDT", address: "0x0000000000000000000000000000000000000001", decimals: 6 },
  { symbol: "ETH", address: "0x0000000000000000000000000000000000000002", decimals: 18 },
  { symbol: "WETH", address: "0x0000000000000000000000000000000000000002", decimals: 18 },
  { symbol: "OKB", address: "0x0000000000000000000000000000000000000003", decimals: 18 },
  { symbol: "USDC", address: "0x0000000000000000000000000000000000000004", decimals: 6 },
];

// Every cache here is keyed by chainId — mainnet and testnet have entirely
// different token lists and vault asset addresses, so a single shared cache
// would leak one chain's tokens into the other's resolution.
const okxCache = new Map<number, { tokens: TokenInfo[]; fetchedAt: number }>();
const coreTokenCache = new Map<number, TokenInfo[]>(); // the vault's own asset token, resolved once on-chain per chain
const CACHE_TTL_MS = 5 * 60_000;

// Circuit breaker: once a live OKX call fails, stop retrying it inline for a
// cooldown window. Without this, every single request (including the
// fast-path classifier, which is supposed to be network-free and <50ms)
// would eat the full request timeout on every call while OKX is down —
// exactly the ~4-6s classifyMs regression this was written to fix.
const degradedUntil = new Map<number, number>();
const DEGRADED_COOLDOWN_MS = 30_000;

/** The vault's configured asset token for this chain, read directly
 *  on-chain — resolved independently of OKX so vault deposits never depend
 *  on a third-party aggregator being reachable. Cached forever per chain (a
 *  deployed token's own symbol/decimals don't change).
 *
 *  Always aliased as "USDT" in addition to its real on-chain symbol: on
 *  testnet this is `DemoUSDT` (on-chain symbol "DUSDT", standing in for
 *  USDT), on mainnet the deploy script requires a real USDT-like address so
 *  the alias is a harmless no-op there. Without this alias, a user typing
 *  "deposit 100 USDT" on testnet would silently resolve to a mock
 *  placeholder address instead of the actual deployed vault asset — exactly
 *  the bug this was written to fix. */
async function getCoreTokens(chainId: number): Promise<TokenInfo[]> {
  const cached = coreTokenCache.get(chainId);
  if (cached) return cached;
  const assetToken = getChainConfig(chainId).contracts.assetToken;
  if (!assetToken) return [];
  try {
    const meta = await getTokenMetadata(chainId, assetToken as Hex);
    const real: TokenInfo = { symbol: meta.symbol, address: assetToken, decimals: meta.decimals };
    const usdtAlias: TokenInfo = { ...real, symbol: "USDT" };
    const result = meta.symbol === "USDT" ? [real] : [real, usdtAlias];
    coreTokenCache.set(chainId, result);
    return result;
  } catch (err) {
    console.error(`[token-registry] failed to read core asset token on-chain for chain ${chainId}:`, err);
    return [];
  }
}

/**
 * Returns the best available token list for a chain. `source` tells the
 * caller what it's actually looking at: "live" (real OKX data), "degraded"
 * (OKX is configured but unreachable/erroring right now — falling back
 * rather than failing the whole request), or "mock" (no OKX key configured,
 * or this chain has no real liquidity for OKX to route through — X Layer
 * testnet, always). The vault's own asset token is always included
 * regardless of source.
 */
export async function getTokenRegistry(chainId: number): Promise<{ tokens: TokenInfo[]; source: "live" | "degraded" | "mock" }> {
  const coreTokens = await getCoreTokens(chainId);

  if (!config.okxDexConfigured || chainId !== 196) {
    const coreSymbols = new Set(coreTokens.map((t) => t.symbol));
    const tokens = [...coreTokens, ...MOCK_TOKENS.filter((t) => !coreSymbols.has(t.symbol))];
    return { tokens, source: "mock" };
  }

  const cached = okxCache.get(chainId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { tokens: mergeCoreTokens(cached.tokens, coreTokens), source: "live" };
  }

  const degraded = degradedUntil.get(chainId) ?? 0;
  if (Date.now() < degraded) {
    // Still in the cooldown window from a recent failure — return instantly
    // from fallback data rather than re-attempting a call we already know
    // will time out.
    const fallback = cached?.tokens ?? MOCK_TOKENS;
    return { tokens: mergeCoreTokens(fallback, coreTokens), source: "degraded" };
  }

  try {
    const raw = await getAllTokens(chainId);
    const tokens = raw.map((t) => ({
      symbol: t.tokenSymbol.toUpperCase(),
      address: t.tokenContractAddress,
      decimals: Number(t.decimals),
    }));
    okxCache.set(chainId, { tokens, fetchedAt: Date.now() });
    return { tokens: mergeCoreTokens(tokens, coreTokens), source: "live" };
  } catch (err) {
    // OKX being slow/unreachable must never take down token resolution for
    // flows (like vault deposits) that don't actually need OKX at all. Fall
    // back to whatever we can resolve on-chain + a stale cache if we have one,
    // and start the cooldown so the NEXT call doesn't pay the timeout again.
    const reason = err instanceof OkxDexUnreachableError ? err.message : String(err);
    console.warn(`[token-registry] OKX token list unavailable for chain ${chainId}, degrading gracefully for ${DEGRADED_COOLDOWN_MS}ms: ${reason}`);
    degradedUntil.set(chainId, Date.now() + DEGRADED_COOLDOWN_MS);
    const fallback = okxCache.get(chainId)?.tokens ?? MOCK_TOKENS;
    return { tokens: mergeCoreTokens(fallback, coreTokens), source: "degraded" };
  }
}

/** Core (on-chain-verified) tokens always win symbol-collisions against a
 *  third-party list — they're ground truth for this deployment, an
 *  aggregator's list is not. */
function mergeCoreTokens(tokens: TokenInfo[], coreTokens: TokenInfo[]): TokenInfo[] {
  if (coreTokens.length === 0) return tokens;
  const coreSymbols = new Set(coreTokens.map((t) => t.symbol));
  return [...coreTokens, ...tokens.filter((t) => !coreSymbols.has(t.symbol))];
}

export async function resolveSymbol(chainId: number, symbol: string): Promise<TokenInfo | null> {
  const { tokens } = await getTokenRegistry(chainId);
  return tokens.find((t) => t.symbol === symbol.toUpperCase()) ?? null;
}

export async function resolveAddress(chainId: number, address: string): Promise<TokenInfo | null> {
  const { tokens } = await getTokenRegistry(chainId);
  const lower = address.toLowerCase();
  return tokens.find((t) => t.address.toLowerCase() === lower) ?? null;
}
