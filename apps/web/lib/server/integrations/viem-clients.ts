import { createPublicClient, createWalletClient, http, type Chain, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { X_LAYER_MAINNET, X_LAYER_TESTNET } from "@candor/shared";
import { config, getChainConfig } from "../config";

function toViemChain(chainId: number, rpcUrl: string): Chain {
  const def = chainId === X_LAYER_MAINNET.id ? X_LAYER_MAINNET : X_LAYER_TESTNET;
  return {
    id: def.id,
    name: def.name,
    nativeCurrency: def.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "OKLink", url: def.blockExplorer } },
  };
}

// Cached per chain rather than rebuilt per call — cheap either way, but a
// warm serverless instance reuses these across requests for the same chain.
const publicClients = new Map<number, PublicClient>();
const agentWalletClients = new Map<number, WalletClient | null>();

export function getPublicClient(chainId: number): PublicClient {
  const cached = publicClients.get(chainId);
  if (cached) return cached;
  const chain = getChainConfig(chainId);
  const client = createPublicClient({ chain: toViemChain(chainId, chain.rpcUrl), transport: http(chain.rpcUrl) });
  publicClients.set(chainId, client);
  return client;
}

/**
 * Wallet client for the backend's agent signer — used ONLY to call
 * ReasoningLedger.recordVerdict() on whichever chain the request is for. It
 * never holds or moves user funds; the user's own wallet signs every
 * swap/deposit transaction directly. `null` when AGENT_SIGNER_PRIVATE_KEY
 * isn't configured (dev/mock mode) — the same key is authorized on both
 * chains' ReasoningLedger, verified against each deploy's broadcast log.
 */
export function getAgentWalletClient(chainId: number): WalletClient | null {
  if (agentWalletClients.has(chainId)) return agentWalletClients.get(chainId)!;
  if (!config.agentSignerConfigured) {
    agentWalletClients.set(chainId, null);
    return null;
  }
  const chain = getChainConfig(chainId);
  const client = createWalletClient({
    account: privateKeyToAccount(config.agentSignerPrivateKey as `0x${string}`),
    chain: toViemChain(chainId, chain.rpcUrl),
    transport: http(chain.rpcUrl),
  });
  agentWalletClients.set(chainId, client);
  return client;
}
