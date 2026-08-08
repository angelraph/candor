import type { VerdictType } from "@candor/shared";

const STYLES: Record<VerdictType, string> = {
  EXECUTE: "bg-candor-100 text-candor-600 dark:bg-candor-600/20 dark:text-candor-400",
  EXECUTE_SMALLER: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  WAIT: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  REJECT: "bg-red-100 text-danger dark:bg-danger/20 dark:text-red-300",
};

const LABELS: Record<VerdictType, string> = {
  EXECUTE: "Execute",
  EXECUTE_SMALLER: "Execute smaller",
  WAIT: "Wait",
  REJECT: "Reject",
};

export function VerdictBadge({ verdict, riskScore }: { verdict: VerdictType; riskScore: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${STYLES[verdict]}`}>
      {LABELS[verdict]}
      <span className="opacity-70">· risk {riskScore}/100</span>
    </span>
  );
}
