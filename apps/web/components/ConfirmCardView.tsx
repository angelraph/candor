import type { ConfirmCard } from "@candor/shared";
import { VerdictBadge } from "./VerdictBadge";
import { LatencyBadge } from "./LatencyBadge";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface Props {
  card: ConfirmCard;
  busy: "confirm" | "override" | "dismiss" | null;
  onConfirm: () => void;
  onOverride: () => void;
  onDismiss: () => void;
}

export function ConfirmCardView({ card, busy, onConfirm, onOverride, onDismiss }: Props) {
  const { action, quote, vaultState, verdict } = card;
  const isClean = verdict.verdict === "EXECUTE";
  const expired = Date.now() > card.expiresAt;
  // A mocked quote has no real route to execute — confirming it only
  // anchors Candor's verdict, it never asks the wallet to sign anything
  // (see intent-pipeline.ts's preparedTx logic for why: the alternative was
  // a meaningless zero-value, empty-calldata "swap" that OKX Wallet's own
  // security scanner correctly refused to sign).
  const mockNoTx = action.type === "swap" && quote?.mock === true;

  return (
    <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-3">
        <VerdictBadge verdict={verdict.verdict} riskScore={verdict.riskScore} />
        <LatencyBadge latency={card.latency} />
      </div>

      <div className="mt-3 text-sm leading-relaxed">
        {action.type === "swap" ? (
          <p>
            Swap <span className="font-mono">{action.params.amountWei}</span> ({short(action.params.fromToken)}) →{" "}
            <span className="font-mono">{quote?.expectedOutWei ?? "…"}</span> ({short(action.params.toToken)})
            {quote?.mock && (
              <span className="ml-2 text-[11px] text-warn">MOCK QUOTE (no live DEX routing on this network)</span>
            )}
          </p>
        ) : (
          <p>
            Deposit <span className="font-mono">{action.params.amountWei}</span> ({short(action.params.assetToken)})
            into vault {short(action.params.vaultAddress)}
            {vaultState && (
              <span className="ml-1 text-black/50 dark:text-white/50">
                ({(vaultState.aprBps / 100).toFixed(1)}% APR, {(vaultState.utilizationBps / 100).toFixed(0)}% full)
              </span>
            )}
          </p>
        )}
      </div>

      <p className="mt-3 rounded-lg bg-black/5 p-3 text-sm leading-relaxed dark:bg-white/10">
        <span className="font-semibold">Candor's take: </span>
        {verdict.rationale}
        {verdict.source === "rule" && (
          <span className="ml-1.5 text-[11px] uppercase tracking-wide text-black/40 dark:text-white/40">
            rule engine
          </span>
        )}
        {verdict.source === "llm" && (
          <span className="ml-1.5 text-[11px] uppercase tracking-wide text-black/40 dark:text-white/40">
            ai adjudicated
          </span>
        )}
      </p>

      {verdict.verdict === "EXECUTE_SMALLER" && verdict.suggestedAmountWei && (
        <p className="mt-2 text-xs text-black/60 dark:text-white/50">
          Suggested amount instead: <span className="font-mono">{verdict.suggestedAmountWei}</span>
        </p>
      )}

      {mockNoTx && !expired && (
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          This quote is mocked, so confirming won't ask your wallet to sign anything — it just anchors Candor's
          verdict on-chain.
        </p>
      )}

      {expired ? (
        <p className="mt-4 text-sm text-danger">This quote is stale now. Just ask again for a fresh one.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isClean ? (
            <button
              onClick={onConfirm}
              disabled={busy !== null}
              className="rounded-full bg-candor-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-candor-600 disabled:opacity-50"
            >
              {busy === "confirm" ? "Confirming…" : "Confirm"}
            </button>
          ) : verdict.verdict !== "REJECT" ? (
            <>
              <button
                onClick={onConfirm}
                disabled={busy !== null}
                className="rounded-full bg-candor-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-candor-600 disabled:opacity-50"
              >
                {busy === "confirm" ? "Confirming…" : "Accept Candor's suggestion"}
              </button>
              <button
                onClick={onOverride}
                disabled={busy !== null}
                className="rounded-full border border-danger/40 px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
              >
                {busy === "override" ? "Proceeding…" : "Proceed anyway"}
              </button>
            </>
          ) : (
            <button
              onClick={onOverride}
              disabled={busy !== null}
              className="rounded-full border border-danger/40 px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              {busy === "override" ? "Proceeding…" : "Proceed anyway (overrides a rejection)"}
            </button>
          )}
          <button
            onClick={onDismiss}
            disabled={busy !== null}
            className="rounded-full px-4 py-2 text-sm text-black/50 transition hover:bg-black/5 disabled:opacity-50 dark:text-white/50 dark:hover:bg-white/10"
          >
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] text-black/30 dark:text-white/30">
        intent {card.intentHash.slice(0, 10)}… · this verdict gets anchored on ReasoningLedger either way, acted on or not.
      </p>
    </div>
  );
}
