/**
 * A throttle for "something may have changed, check again" requests.
 *
 * The first request runs at once. Requests inside the gap after a run are
 * folded into one trailing run at the end of the gap, so a burst costs at
 * most two runs and the last request is never dropped. The workspace context
 * uses it to re-read `/api/mobile/me` after refused (403) requests.
 *
 * @see lib/org-context.tsx
 */

/** Timer functions, injectable so tests can drive time by hand. */
type Timers = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

/**
 * @param args.gapMs - Shortest time between two runs.
 * @param args.run - What to do on each run.
 * @param args.timers - Clock and timers; the real ones by default.
 * @returns `request` to ask for a run, `cancel` to drop a pending one.
 */
export function createRecheckThrottle({
  gapMs,
  run,
  timers = {
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: {
  gapMs: number;
  run: () => void;
  timers?: Timers;
}) {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let pending: unknown = null;

  const fire = () => {
    pending = null;
    lastRunAt = timers.now();
    run();
  };

  return {
    /** Runs now, or once at the end of the current gap when one is open. */
    request() {
      if (pending !== null) return;
      const wait = lastRunAt + gapMs - timers.now();
      if (wait <= 0) fire();
      else pending = timers.setTimer(fire, wait);
    },
    /** Drops a pending trailing run. */
    cancel() {
      if (pending !== null) timers.clearTimer(pending);
      pending = null;
    },
  };
}
