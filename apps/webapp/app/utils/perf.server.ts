/**
 * Lightweight server-side performance tracking for route loaders.
 *
 * Logs timing data for database queries and data processing in loaders.
 * In development, it logs to the console with color-coded timing.
 * In production, it emits structured JSON for monitoring ingestion.
 *
 * @example
 *   const perf = createPerfTracker("assets._index");
 *   const data = await perf.measure("getAssets", () => getAssets(...));
 *   perf.report();
 */

import { NODE_ENV } from "./env";

interface PerfEntry {
  label: string;
  startMs: number;
  durationMs: number;
}

/**
 * Creates a perf tracker scoped to a single route loader invocation.
 *
 * @param routeName - Human-readable route identifier for log output
 * @returns Object with measure(), measureSync(), report(), getEntries(), elapsed()
 */
export function createPerfTracker(routeName: string) {
  const entries: PerfEntry[] = [];
  const routeStart = performance.now();

  return {
    /**
     * Measure an async operation and record its timing.
     * Returns the operation's result unchanged.
     */
    async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        entries.push({
          label,
          startMs: start - routeStart,
          durationMs: performance.now() - start,
        });
      }
    },

    /**
     * Measure a synchronous operation.
     */
    measureSync<T>(label: string, fn: () => T): T {
      const start = performance.now();
      try {
        return fn();
      } finally {
        entries.push({
          label,
          startMs: start - routeStart,
          durationMs: performance.now() - start,
        });
      }
    },

    /**
     * Log a summary of all measured operations.
     * Dev: colored console output. Prod: structured JSON.
     */
    report() {
      const totalMs = performance.now() - routeStart;

      if (NODE_ENV === "development") {
        const sorted = [...entries].sort((a, b) => b.durationMs - a.durationMs);
        const lines = sorted.map((e) => {
          const bar = "█".repeat(
            Math.max(1, Math.round((e.durationMs / totalMs) * 30))
          );
          const color =
            e.durationMs > 100
              ? "\x1b[31m" // red >100ms
              : e.durationMs > 30
              ? "\x1b[33m" // yellow >30ms
              : "\x1b[32m"; // green
          return `  ${color}${bar}\x1b[0m ${e.label}: ${e.durationMs.toFixed(
            1
          )}ms (started +${e.startMs.toFixed(0)}ms)`;
        });

        console.log(
          `\n\x1b[36m⏱ ${routeName}\x1b[0m — ${totalMs.toFixed(
            0
          )}ms total\n${lines.join("\n")}`
        );
      } else {
        // Structured log for production monitoring (Sentry, Datadog, etc.)
        console.log(
          JSON.stringify({
            type: "perf",
            route: routeName,
            totalMs: Math.round(totalMs),
            operations: entries.map((e) => ({
              label: e.label,
              ms: Math.round(e.durationMs),
              startMs: Math.round(e.startMs),
            })),
          })
        );
      }
    },

    /** Get raw entries for programmatic use */
    getEntries(): ReadonlyArray<PerfEntry> {
      return entries;
    },

    /** Total elapsed time since tracker creation */
    elapsed(): number {
      return performance.now() - routeStart;
    },
  };
}
