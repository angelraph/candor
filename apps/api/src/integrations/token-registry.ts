import { config } from "../config.js";
import { getAllTokens } from "./okx-dex.js";

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

let cache: { tokens: TokenInfo[]; fetchedAt: number; mock: boolean } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

export async function getTokenRegistry(): Promise<{ tokens: TokenInfo[]; mock: boolean }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { tokens: cache.tokens, mock: cache.mock };
  }

  if (!config.okxDexConfigured) {
    cache = { tokens: MOCK_TOKENS, fetchedAt: Date.now(), mock: true };
    return { tokens: MOCK_TOKENS, mock: true };
  }

  const raw = await getAllTokens();
  const tokens = raw.map((t) => ({
    symbol: t.tokenSymbol.toUpperCase(),
    address: t.tokenContractAddress,
    decimals: Number(t.decimals),
  }));
  cache = { tokens, fetchedAt: Date.now(), mock: false };
  return { tokens, mock: false };
}

export async function resolveSymbol(symbol: string): Promise<TokenInfo | null> {
  const { tokens } = await getTokenRegistry();
  return tokens.find((t) => t.symbol === symbol.toUpperCase()) ?? null;
}

export async function resolveAddress(address: string): Promise<TokenInfo | null> {
  const { tokens } = await getTokenRegistry();
  const lower = address.toLowerCase();
  return tokens.find((t) => t.address.toLowerCase() === lower) ?? null;
}
