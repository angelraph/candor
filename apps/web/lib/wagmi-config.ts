import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import type { Chain } from "viem";
import { X_LAYER_MAINNET, X_LAYER_TESTNET } from "@candor/shared";

function toViemChain(def: typeof X_LAYER_MAINNET | typeof X_LAYER_TESTNET): Chain {
  return {
    id: def.id,
    name: def.name,
    nativeCurrency: def.nativeCurrency,
    rpcUrls: {
      default: { http: [...def.rpcUrls.default.http] },
    },
    blockExplorers: {
      default: { name: "OKLink", url: def.blockExplorer },
    },
  };
}

export const xLayerMainnet = toViemChain(X_LAYER_MAINNET);
export const xLayerTestnet = toViemChain(X_LAYER_TESTNET);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// WalletConnect is optional — omitted (not silently broken) when no project
// ID is configured, same "explicit mock/live flag" pattern as the backend.
// The injected connector (OKX Wallet extension, MetaMask, etc.) always works.
const connectors = [
  injected(),
  ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
];

export const wagmiConfig = createConfig({
  chains: [xLayerTestnet, xLayerMainnet],
  connectors,
  transports: {
    [xLayerTestnet.id]: http(),
    [xLayerMainnet.id]: http(),
  },
  ssr: true,
});

export const walletConnectConfigured = Boolean(walletConnectProjectId);
