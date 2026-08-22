"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import type { Hash } from "viem";
import type { ConfirmCard } from "@candor/shared";
import { postIntent, finalizeIntent, requestTestnetFaucet, ApiError } from "@/lib/api-client";
import { ERC20_ABI } from "@/lib/erc20-abi";
import { describeTxError } from "@/lib/describe-error";
import { xLayerTestnet } from "@/lib/wagmi-config";
import { explorerTxUrl } from "@/lib/explorer";
import { ConfirmCardView } from "./ConfirmCardView";

// Official OKX faucet — the one thing we can't hand out ourselves, since it
// pays out the chain's native gas token, not an ERC20 we control.
const OKB_FAUCET_URL = "https://web3.okx.com/xlayer/faucet";

interface LedgerStatusResult {
  status: "unconfigured" | "pending" | "confirmed" | "failed";
  txHash: string | null;
  error: string | null;
}

const EXAMPLE_PROMPTS = [
  "swap 10 USDT to ETH",
  "swap 50000 USDT to ETH",
  "deposit 500 USDT into the best yield",
  "hedge my portfolio against a BTC crash",
];

type Decision = "confirm" | "override" | "dismiss";

/** A tx hash, shortened and linked to the right chain's OKLink explorer —
 *  falls back to plain unlinked text for an unrecognized chain rather than
 *  guessing a URL that might 404. */
function TxHashLink({ chainId, hash, label }: { chainId: number; hash: string; label: string }) {
  const url = explorerTxUrl(chainId, hash);
  const text = `${label}: ${hash}`;
  if (!url) return <p className="mt-1 font-mono text-xs">{text}</p>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block font-mono text-xs text-candor-600 underline-offset-2 hover:underline dark:text-candor-400"
    >
      {text} ↗
    </a>
  );
}

export function ChatPanel() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmCard, setConfirmCard] = useState<ConfirmCard | null>(null);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string | null; anchored: boolean; chainId: number } | null>(null);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatusResult | null>(null);
  const [faucetState, setFaucetState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [faucetError, setFaucetError] = useState<string | null>(null);

  async function handleFaucet() {
    if (!address) return;
    setFaucetState("pending");
    setFaucetError(null);
    try {
      await requestTestnetFaucet(address);
      setFaucetState("done");
    } catch (err) {
      setFaucetState("error");
      setFaucetError(err instanceof ApiError ? err.message : "Couldn't reach the faucet. Try again.");
    }
  }

  // The ledger-anchor tx is submitted server-side (see finalizeIntent) but
  // confirmed here in the browser — same publicClient already used to track
  // the user's own swap/deposit tx below. No backend status endpoint to poll:
  // a serverless function can't keep tracking a tx after its response is
  // sent, so the frontend that's already watching chain state does it once
  // instead.
  function watchLedgerAnchor(ledgerTxHash: Hash | null) {
    if (!ledgerTxHash || !publicClient) {
      setLedgerStatus({ status: "unconfigured", txHash: null, error: null });
      return;
    }
    setLedgerStatus({ status: "pending", txHash: ledgerTxHash, error: null });
    publicClient
      .waitForTransactionReceipt({ hash: ledgerTxHash })
      .then((receipt) => {
        setLedgerStatus({
          status: receipt.status === "success" ? "confirmed" : "failed",
          txHash: ledgerTxHash,
          error: receipt.status === "success" ? null : "transaction reverted",
        });
      })
      .catch((err) => {
        setLedgerStatus({
          status: "failed",
          txHash: ledgerTxHash,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async function handleSend() {
    if (!message.trim() || !address || !chainId) return;
    setError(null);
    setResult(null);
    setLedgerStatus(null);
    setLoading(true);
    try {
      const card = await postIntent({ message: message.trim(), userAddress: address, chainId });
      setConfirmCard(card);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong preparing that request.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(decision: Decision) {
    if (!confirmCard || !address || !publicClient) return;
    // The card was quoted and risk-checked against a specific chain (its
    // token addresses, vault, ledger are only valid there). Since the wallet
    // can switch networks at any time via the header's network switcher, a
    // card left open across a switch would sign a transaction built for the
    // chain it was prepared on, not the one the wallet is now connected to.
    if (confirmCard.chainId !== chainId) {
      setError("You switched networks after this quote was prepared. Ask again on the current network.");
      setConfirmCard(null);
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const { tx, ledgerTxHash } = await finalizeIntent(confirmCard.intentHash, decision, confirmCard.token);
      watchLedgerAnchor(ledgerTxHash as Hash | null);

      if (!tx) {
        setResult({ txHash: null, anchored: true, chainId: confirmCard.chainId });
        setConfirmCard(null);
        return;
      }

      const { action } = confirmCard;
      const spender = action.type === "swap" ? (tx.to as `0x${string}`) : (action.params.vaultAddress as `0x${string}`);
      const token = (action.type === "swap" ? action.params.fromToken : action.params.assetToken) as `0x${string}`;
      const amountWei = BigInt(action.params.amountWei);

      // Pre-flight balance check: catch "you don't have enough" as a clear
      // message before spending a wallet round-trip on a signature that was
      // always going to fail on-chain anyway.
      const balance = await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (balance < amountWei) {
        throw new Error("Insufficient balance to cover this transaction.");
      }

      const allowance = await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, spender],
      });

      if (allowance < amountWei) {
        const approveHash = await writeContractAsync({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, amountWei],
        });
        // waitForTransactionReceipt resolves even for a REVERTED tx — it
        // only throws on a genuine RPC/network failure. Must check
        // receipt.status explicitly or a failed approval silently proceeds
        // to the next step as if it had succeeded.
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") {
          throw new Error("The approval transaction failed on-chain. Nothing was swapped or deposited.");
        }
      }

      const txHash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value || "0"),
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(
          "The transaction was mined but reverted, so no funds moved. Usually that means the quote went stale or the pool state changed in the meantime. Try again."
        );
      }

      setResult({ txHash, anchored: true, chainId: confirmCard.chainId });
      setConfirmCard(null);
    } catch (err) {
      setError(describeTxError(err));
    } finally {
      setBusy(null);
    }
  }

  const onTestnet = isConnected && chainId === xLayerTestnet.id;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      {onTestnet && !confirmCard && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-xs">
          <span className="font-medium text-black/70 dark:text-white/70">Testing on X Layer Testnet:</span>
          <a
            href={OKB_FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/10 px-3 py-1 font-medium underline-offset-2 hover:underline dark:border-white/10"
          >
            Get testnet OKB (gas) ↗
          </a>
          <button
            onClick={handleFaucet}
            disabled={faucetState === "pending"}
            className="rounded-full bg-ink px-3 py-1 font-medium text-paper transition hover:opacity-90 disabled:opacity-50 dark:bg-paper dark:text-ink"
          >
            {faucetState === "pending"
              ? "Sending…"
              : faucetState === "done"
                ? "Sent — get 1000 more USDT"
                : "Get 1000 test USDT"}
          </button>
          {faucetState === "error" && <span className="text-danger">{faucetError}</span>}
        </div>
      )}

      {!confirmCard && (
        <div className="w-full">
          <div className="flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
              placeholder={isConnected ? "swap 10 USDT to ETH" : "connect your wallet first"}
              disabled={!isConnected || loading}
              className="flex-1 rounded-full border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none ring-candor-500/30 focus:ring-2 disabled:opacity-50 dark:border-white/10 dark:bg-white/5"
            />
            <button
              onClick={handleSend}
              disabled={!isConnected || loading || !message.trim()}
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:opacity-90 disabled:opacity-40 dark:bg-paper dark:text-ink"
            >
              {loading ? "…" : "Ask"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setMessage(p)}
                className="rounded-full border border-black/10 px-3 py-1.5 text-xs text-black/60 transition hover:border-black/30 dark:border-white/10 dark:text-white/50"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="w-full rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>
      )}

      {confirmCard && (
        <ConfirmCardView
          card={confirmCard}
          busy={busy}
          onConfirm={() => handleDecision("confirm")}
          onOverride={() => handleDecision("override")}
          onDismiss={() => handleDecision("dismiss")}
        />
      )}

      {result && (
        <div className="w-full rounded-xl border border-candor-500/30 bg-candor-50 p-4 text-sm dark:bg-candor-600/10">
          <p className="font-semibold text-candor-600 dark:text-candor-400">Done.</p>
          {result.txHash && <TxHashLink chainId={result.chainId} hash={result.txHash} label="tx" />}
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Ledger anchor:{" "}
            {ledgerStatus?.status === "confirmed"
              ? "confirmed ✅"
              : ledgerStatus?.status === "failed"
                ? "failed ✗"
                : ledgerStatus?.status === "unconfigured"
                  ? "skipped (mock mode)"
                  : "pending…"}
          </p>
          {ledgerStatus?.txHash && (
            <TxHashLink chainId={result.chainId} hash={ledgerStatus.txHash} label="ledger tx" />
          )}
          <button onClick={() => setResult(null)} className="mt-2 text-xs underline">
            Ask something else
          </button>
        </div>
      )}
    </div>
  );
}
