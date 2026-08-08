"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getTrackRecord } from "@/lib/api-client";

const ROWS: Array<{ key: "executeCount" | "executeSmallerCount" | "waitCount" | "rejectCount"; label: string; color: string }> = [
  { key: "executeCount", label: "Execute", color: "bg-candor-500" },
  { key: "executeSmallerCount", label: "Execute smaller", color: "bg-amber-500" },
  { key: "waitCount", label: "Wait", color: "bg-orange-500" },
  { key: "rejectCount", label: "Reject", color: "bg-danger" },
];

export default function TrackRecordPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["track-record"], queryFn: getTrackRecord });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <Link href="/" className="text-sm text-black/50 hover:underline dark:text-white/50">
        ← back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Candor's Track Record</h1>
      <p className="mt-2 text-sm text-black/60 dark:text-white/50">
        Every verdict Candor has ever issued, anchored on <code>ReasoningLedger</code> — not just the ones you
        followed. This is read straight from the contract's aggregate counters, no indexer required.
      </p>

      {isLoading && <p className="mt-8 text-sm text-black/50">Loading…</p>}
      {error && <p className="mt-8 text-sm text-danger">Couldn't reach the ledger. Is the API running?</p>}

      {data && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10">
            <p className="text-4xl font-bold tabular-nums">{data.totalVerdicts}</p>
            <p className="text-sm text-black/50 dark:text-white/50">total verdicts anchored on-chain</p>
          </div>

          <div className="space-y-3">
            {ROWS.map((row) => {
              const value = data[row.key];
              const pct = data.totalVerdicts > 0 ? Math.round((value / data.totalVerdicts) * 100) : 0;
              return (
                <div key={row.key}>
                  <div className="flex justify-between text-sm">
                    <span>{row.label}</span>
                    <span className="tabular-nums text-black/50 dark:text-white/50">
                      {value} ({pct}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div className={`h-full ${row.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-black/10 p-4 text-sm dark:border-white/10">
            <span className="font-semibold">{data.overrodeCount}</span>{" "}
            <span className="text-black/50 dark:text-white/50">
              time{data.overrodeCount === 1 ? "" : "s"} a user proceeded despite Candor advising against it.
            </span>
          </div>

          {data.totalVerdicts === 0 && (
            <p className="text-sm text-black/40 dark:text-white/40">
              No verdicts anchored yet — either the ledger isn't deployed/configured, or nobody's asked Candor
              anything yet.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
