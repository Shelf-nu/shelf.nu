/**
 * useRerenderAt, re-renders the calling component once a given instant passes.
 *
 * For values computed during render from the current time, such as a button
 * that turns disabled when a start time passes. Nothing else re-renders a
 * page left open, so without this the value stays stale until an unrelated
 * update. Schedules a single timeout for the next instant rather than polling.
 *
 * @see {@link file://../components/booking/forms/edit-booking-form.tsx}
 */
import { useEffect, useState } from "react";

/**
 * The longest delay `setTimeout` honours. A larger one overflows and fires at
 * once, so a far-off instant waits this long, re-renders, and reschedules.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Re-renders the component just after `at`.
 *
 * @param at - The instant to re-render after. `null`, an invalid date or one
 *   already past schedules nothing.
 * @returns A counter that changes on each fire. A render alone does not
 *   recompute a `useMemo`, so a memo over a clock-dependent value lists it
 *   as a dependency.
 */
export function useRerenderAt(at: Date | null) {
  /** Bumped on each fire, which also reschedules a capped wait. */
  const [tick, setTick] = useState(0);
  const atMs = at?.getTime() ?? null;

  useEffect(() => {
    if (atMs === null || Number.isNaN(atMs)) return;
    const delay = atMs - Date.now();
    if (delay < 0) return;
    // +1 so the re-render lands strictly after the instant, where a `<=`
    // comparison against it has already flipped
    const id = setTimeout(
      () => setTick((tick) => tick + 1),
      Math.min(delay + 1, MAX_TIMEOUT_MS)
    );
    return () => clearTimeout(id);
  }, [atMs, tick]);

  return tick;
}
