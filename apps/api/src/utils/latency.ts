/**
 * Per-stage latency tracking. The whole point of the fast/slow-path split is
 * that "prepared in Xms" is a real, measured number shown to the user, not a
 * marketing claim — this is what produces that number.
 */
export class Stopwatch {
  private readonly startedAt = performance.now();
  private readonly marks = new Map<string, number>();

  mark(stage: string, sinceMs: number): void {
    this.marks.set(stage, Math.round(sinceMs));
  }

  /** Times an async stage and records its duration under `stage`. */
  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.marks.set(stage, Math.round(performance.now() - start));
    }
  }

  totalMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  breakdown(): { classifyMs: number; quoteMs: number; simulateMs: number; verdictMs: number; totalMs: number } {
    return {
      classifyMs: this.marks.get("classify") ?? 0,
      quoteMs: this.marks.get("quote") ?? 0,
      simulateMs: this.marks.get("simulate") ?? 0,
      verdictMs: this.marks.get("verdict") ?? 0,
      totalMs: this.totalMs(),
    };
  }
}
