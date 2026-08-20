import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { X_LAYER_MAINNET, X_LAYER_TESTNET } from "@candor/shared";
import { config } from "../config";

function toViemChain(def: typeof X_LAYER_MAINNET | typeof X_LAYER_TESTNET): Chain {
  return {
    id: def.id,
    name: def.name,
    nativeCurrency: def.nativeCurrency,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "OKLink", url: def.blockExplorer },
    },
  };
}

export const chain: Chain = toViemChain(config.chainId === X_LAYER_MAINNET.id ? X_LAYER_MAINNET : X_LAYER_TESTNET);

/** Read-only client — quotes, simulation, vault state reads. No secrets needed. */
export const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

/**
 * Wallet client for the backend's agent signer — used ONLY to call
 * ReasoningLedger.recordVerdict(). It never holds or moves user funds; the
 * user's own wallet signs every swap/deposit transaction directly.
 * `null` when AGENT_SIGNER_PRIVATE_KEY isn't configured (dev/mock mode).
 */
export const agentWalletClient = config.agentSignerConfigured
  ? createWalletClient({
      account: privateKeyToAccount(config.agentSignerPrivateKey as `0x${string}`),
      chain,
      transport: http(config.rpcUrl),
    })
  : null;

export const agentSignerAddress = agentWalletClient?.account.address ?? null;
