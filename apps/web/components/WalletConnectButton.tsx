"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { xLayerMainnet } from "@/lib/wagmi-config";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, isConnected, chainId, status } = useAccount();
  const { connect, connectors: rawConnectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);
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
            {isPending ? "Connecting…" : `Connect ${only.name}`}
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

  // The deployed contracts (vault, DemoUSDT/asset token, ReasoningLedger)
  // only exist on X Layer mainnet now — testnet was the pre-launch chain,
  // it's not a valid target anymore. Connected-on-testnet used to pass this
  // check, which let a balanceOf/read against a mainnet-only address run
  // against testnet RPC and silently return no data ("0x").
  const wrongChain = chainId !== xLayerMainnet.id;

  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button
          onClick={() => switchChain({ chainId: xLayerMainnet.id })}
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
