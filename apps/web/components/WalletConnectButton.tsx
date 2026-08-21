"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { xLayerMainnet, xLayerTestnet } from "@/lib/wagmi-config";

const NETWORKS = [
  { chainId: xLayerMainnet.id, label: "X Layer", short: "Mainnet" },
  { chainId: xLayerTestnet.id, label: "X Layer Testnet", short: "Testnet" },
];

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Desktop extensions (MetaMask, OKX Wallet, Rabby, ...) announce themselves
// via EIP-6963, so `connector.name` is already correct there. Mobile wallet
// in-app browsers (OKX Wallet's app, MetaMask mobile, Trust Wallet) often
// inject window.ethereum WITHOUT that announcement, so wagmi falls back to
// its generic `injected` connector — whose name is literally the string
// "Injected", which is what was rendering as "Connect Injected" on mobile.
// Those same providers still set their own identifying flag on
// window.ethereum even without EIP-6963, so read that instead.
function detectInjectedWalletName(): string {
  if (typeof window === "undefined") return "Wallet";
  const eth = (window as { ethereum?: Record<string, unknown> }).ethereum;
  if (!eth) return "Wallet";
  if (eth.isOkxWallet || eth.isOKExWallet) return "OKX Wallet";
  if (eth.isMetaMask) return "MetaMask";
  if (eth.isTrust || eth.isTrustWallet) return "Trust Wallet";
  if (eth.isCoinbaseWallet) return "Coinbase Wallet";
  if (eth.isRabby) return "Rabby";
  return "Wallet";
}

export function WalletConnectButton() {
  const { address, isConnected, chainId, status } = useAccount();
  const { connect, connectors: rawConnectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switchPending } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  // wagmi v2 doesn't expose a typed "which connector is pending" field on
  // useConnect (its v1 pendingConnector is gone), so track it ourselves —
  // set right before calling connect(), cleared once isPending drops.
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // wagmi's silent session-restore on load ("connecting"/"reconnecting")
  // normally settles in well under a second. But it's a real network/extension
  // operation, not a guaranteed-fast local check — a sleepy extension
  // background worker or a hung provider call can leave it stuck in that
  // state indefinitely. The previous fix hid the connect button for the
  // whole "connecting"/"reconnecting" window with no way out if it never
  // resolved, which is worse than the bug it fixed. This caps how long we
  // wait: past 3s, give up waiting and show the real connect button instead
  // of a permanent "Checking wallet…" dead end.
  const [givenUpWaiting, setGivenUpWaiting] = useState(false);
  useEffect(() => {
    if (status !== "connecting" && status !== "reconnecting") {
      setGivenUpWaiting(false);
      return;
    }
    const t = setTimeout(() => setGivenUpWaiting(true), 3_000);
    return () => clearTimeout(t);
  }, [status]);

  // Every maintained wallet (MetaMask, OKX Wallet, Coinbase, Rabby, ...)
  // announces itself via EIP-6963, and wagmi auto-discovers each one as its
  // own properly-named connector — that's where "MetaMask", "OKX Wallet" etc.
  // come from below, no config needed. The generic `injected()` connector we
  // also register (id "injected") is a same-shape duplicate of whichever one
  // of those happens to currently own `window.ethereum`. With more than one
  // wallet extension installed, that's a coin flip, and calling connect() on
  // it can bind to a stale/wrong provider that never resolves — the button
  // just sits there with no popup and no error, which is the exact "clicked
  // and nothing happened" symptom this was causing. Dropping it whenever a
  // named connector exists removes that broken path entirely; it only stays
  // as a last resort when it's the only thing available.
  const namedConnectors = rawConnectors.filter((c) => c.id !== "injected");
  const connectors = namedConnectors.length > 0 ? namedConnectors : rawConnectors;

  useEffect(() => {
    if (!isPending) setPendingUid(null);
  }, [isPending]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!networkMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) setNetworkMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [networkMenuOpen]);

  // On page load, wagmi silently tries to restore a previous session
  // (`status: "reconnecting"`) before `isConnected` flips true. That window
  // used to be invisible: the button already rendered as clickable
  // "Connect...", and clicking mid-reconnect handed the connector to
  // connect() a second time while it was already busy connecting itself,
  // which wagmi rejects with ConnectorAlreadyConnectedError — a real,
  // reproducible race, not a fluke. Render a neutral, non-interactive state
  // for that whole window instead so there's nothing to click yet.
  if ((status === "connecting" || status === "reconnecting") && !givenUpWaiting) {
    return (
      <span className="rounded-full border border-black/10 px-4 py-2 text-sm text-black/40 dark:border-white/10 dark:text-white/40">
        Checking wallet…
      </span>
    );
  }

  if (!isConnected) {
    if (connectors.length === 0) {
      return (
        <span className="rounded-full border border-black/10 px-4 py-2 text-sm text-black/40 dark:border-white/10 dark:text-white/40">
          No wallet detected
        </span>
      );
    }

    // ConnectorAlreadyConnectedError means wagmi's internal state is already
    // connected/connecting for this connector — the `status` guard above
    // should catch that window, but if it still slips through (e.g. a
    // double-click before React re-renders), it's self-resolving as soon as
    // `isConnected` catches up, not something the user did wrong. Don't show
    // it as a scary error; every other failure (rejected in the wallet,
    // extension locked, etc.) is real and worth surfacing.
    const benignRace = error?.name === "ConnectorAlreadyConnectedError";

    // A failed connect attempt (rejected in the wallet, wrong provider,
    // extension locked, etc.) used to fail silently — the button just reset
    // with zero feedback, which read as the UI being stuck. Surface it.
    const errorNote = error && !benignRace && !isPending && (
      <p className="mt-1.5 max-w-[14rem] text-right text-[11px] text-danger">
        {error.message.split("\n")[0].replace(/\.$/, "")}. Try again, or check your wallet is unlocked.
      </p>
    );

    if (connectors.length === 1) {
      const only = connectors[0];
      const displayName = only.id === "injected" ? detectInjectedWalletName() : only.name;
      return (
        <div className="flex flex-col items-end">
          <button
            onClick={() => {
              setPendingUid(only.uid);
              connect({ connector: only });
            }}
            disabled={isPending}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50 dark:bg-paper dark:text-ink"
          >
            {isPending ? "Connecting…" : `Connect ${displayName}`}
          </button>
          {errorNote}
        </div>
      );
    }

    return (
      <div className="relative flex flex-col items-end" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={isPending}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-50 dark:bg-paper dark:text-ink"
        >
          {isPending ? "Connecting…" : "Connect Wallet"}
        </button>
        {errorNote}
        {menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-2 w-56 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-ink">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => {
                  setMenuOpen(false);
                  setPendingUid(connector.uid);
                  connect({ connector });
                }}
                disabled={isPending}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
              >
                {connector.icon && <img src={connector.icon} alt="" className="h-5 w-5 rounded" />}
                <span>
                  {pendingUid === connector.uid && isPending ? `Connecting to ${connector.name}…` : connector.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Both chains are real, live deployments (see config.ts's TESTNET_CONTRACTS
  // and the mainnet env vars) — testnet exists specifically so anyone
  // without real funds can try the whole flow, then switch to mainnet only
  // once they actually want to. Anything that isn't one of the two X Layer
  // chains (e.g. still on Ethereum mainnet from a previous site) is the only
  // state that actually needs a forced switch.
  const currentNetwork = NETWORKS.find((n) => n.chainId === chainId);
  const unsupportedChain = !currentNetwork;

  return (
    <div className="flex items-center gap-2">
      {unsupportedChain && (
        <button
          onClick={() => switchChain({ chainId: xLayerMainnet.id })}
          disabled={switchPending}
          className="rounded-full bg-warn px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        >
          {switchPending ? "Switching…" : "Switch to X Layer"}
        </button>
      )}
      {currentNetwork && (
        <div className="relative" ref={networkMenuRef}>
          <button
            onClick={() => setNetworkMenuOpen((v) => !v)}
            disabled={switchPending}
            className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-white/10"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${currentNetwork.chainId === xLayerMainnet.id ? "bg-candor-500" : "bg-warn"}`}
            />
            {switchPending ? "Switching…" : currentNetwork.short}
          </button>
          {networkMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-44 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-ink">
              {NETWORKS.map((network) => (
                <button
                  key={network.chainId}
                  onClick={() => {
                    setNetworkMenuOpen(false);
                    if (network.chainId !== chainId) switchChain({ chainId: network.chainId });
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {network.label}
                  {network.chainId === chainId && <span className="text-candor-500">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
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
