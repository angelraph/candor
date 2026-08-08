"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import type { ConfirmCard } from "@candor/shared";
import { postIntent, finalizeIntent, getLedgerStatus, ApiError, type LedgerStatusResult } from "@/lib/api-client";
import { ERC20_ABI } from "@/lib/erc20-abi";
import { ConfirmCardView } from "./ConfirmCardView";

const EXAMPLE_PROMPTS = [
  "swap 10 USDT to ETH",
  "swap 50000 USDT to ETH",
  "deposit 500 USDT into the best yield",
  "hedge my portfolio against a BTC crash",
];

type Decision = "confirm" | "override" | "dismiss";

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
  const [result, setResult] = useState<{ txHash: string | null; anchored: boolean } | null>(null);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatusResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function pollLedgerStatus(intentHash: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const status = await getLedgerStatus(intentHash).catch(() => null);
      if (!status) return;
      setLedgerStatus(status);
      if (status.status === "confirmed" || status.status === "failed" || status.status === "unconfigured") {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 2000);
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
    setBusy(decision);
    setError(null);
    try {
      const { tx } = await finalizeIntent(confirmCard.intentHash, decision);
      pollLedgerStatus(confirmCard.intentHash);

      if (!tx) {
        setResult({ txHash: null, anchored: true });
        setConfirmCard(null);
        return;
      }

      const { action } = confirmCard;
      const spender = action.type === "swap" ? (tx.to as `0x${string}`) : (action.params.vaultAddress as `0x${string}`);
      const token = (action.type === "swap" ? action.params.fromToken : action.params.assetToken) as `0x${string}`;
      const amountWei = BigInt(action.params.amountWei);

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
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const txHash = await sendTransactionAsync({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value || "0"),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setResult({ txHash, anchored: true });
      setConfirmCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The transaction didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
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
          {result.txHash && <p className="mt-1 font-mono text-xs">tx: {result.txHash}</p>}
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
          <button onClick={() => setResult(null)} className="mt-2 text-xs underline">
            Ask something else
          </button>
        </div>
      )}
    </div>
  );
}
