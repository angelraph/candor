/**
 * X Layer network constants, shared so apps/web (viem custom chain def) and
 * apps/api (server-side viem client + Foundry deploy env) never drift apart.
 *
 * Source: OKX X Layer developer docs (web3.okx.com/xlayer/docs/developer).
 * Gas is paid in OKB, not ETH.
 */

export const X_LAYER_MAINNET = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
    okx: { http: ["https://xlayerrpc.okx.com"] },
  },
  blockExplorer: "https://www.oklink.com/xlayer",
} as const;

export const X_LAYER_TESTNET = {
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testrpc.xlayer.tech/terigon"] },
    okx: { http: ["https://xlayertestrpc.okx.com/terigon"] },
  },
  blockExplorer: "https://www.oklink.com/xlayer-test",
} as const;

export function isSupportedChainId(chainId: number): boolean {
  return chainId === X_LAYER_MAINNET.id || chainId === X_LAYER_TESTNET.id;
}
