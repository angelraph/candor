import type { LatencyBreakdown } from "@candor/shared";

export function LatencyBadge({ latency }: { latency: LatencyBreakdown }) {
  return (
    <span
      title={`classify ${latency.classifyMs}ms · quote ${latency.quoteMs}ms · simulate ${latency.simulateMs}ms · verdict ${latency.verdictMs}ms`}
      className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 font-mono text-[11px] text-black/60 dark:border-white/10 dark:text-white/50"
    >
      ⚡ prepared in {latency.totalMs}ms
    </span>
  );
}
