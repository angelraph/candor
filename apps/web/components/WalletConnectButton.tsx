"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { xLayerTestnet } from "@/lib/wagmi-config";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <button
        onClick={() => injectedConnector && connect({ connector: injectedConnector })}
        disabled={isPending || !injectedConnector}
        className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50 dark:bg-paper dark:text-ink"
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== xLayerTestnet.id && chainId !== 196;

  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button
          onClick={() => switchChain({ chainId: xLayerTestnet.id })}
          className="rounded-full bg-warn px-3 py-1.5 text-xs font-medium text-ink"
        >
          Switch to X Layer
        </button>
      )}
      <span className="rounded-full border border-black/10 px-3 py-1.5 font-mono text-xs dark:border-white/10">
        {address ? short(address) : ""}
      </span>
      <button
        onClick={() => disconnect()}
        className="text-xs text-black/50 underline-offset-2 hover:underline dark:text-white/50"
      >
        Disconnect
      </button>
    </div>
  );
}
