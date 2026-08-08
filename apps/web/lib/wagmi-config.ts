import { createConfig, http, injected } from "wagmi";
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

// WalletConnect deliberately omitted for now: `wagmi/connectors` only ships
// as one barrel file, and importing anything from it (even just
// `walletConnect`) statically pulls in the `baseAccount` connector too,
// which transitively depends on @coinbase/cdp-sdk's x402 payment code —
// which references unpublished `@x402/*` packages and fails to build. Not
// a real loss right now: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't
// configured anyway. The injected connector (OKX Wallet extension,
// MetaMask, etc.) covers the actual demo path. Revisit via a dynamic
// `import("wagmi/connectors")` (code-split, only loaded if a project ID
// is ever configured) if WalletConnect support becomes worth the effort.
const connectors = [injected()];

export const wagmiConfig = createConfig({
  chains: [xLayerTestnet, xLayerMainnet],
  connectors,
  transports: {
    [xLayerTestnet.id]: http(),
    [xLayerMainnet.id]: http(),
  },
  ssr: true,
});

export const walletConnectConfigured = false;
