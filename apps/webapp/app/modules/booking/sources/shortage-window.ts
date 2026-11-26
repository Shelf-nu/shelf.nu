/**
 * The window a booking's pool sources are judged short over.
 *
 * One rule for every reader that decides shortness: the booking page and the
 * check-out drawers (through `getSliceSourceSummaries`) and the check-out
 * itself (`dispatchUnits`). When they measure the same window, the page flags
 * a source short exactly when the check-out refuses it.
 *
 * A booking is judged over what is left of its window: `[max(from, now), to)`.
 * Time already behind us holds nothing any more, so a competing hold whose
 * window has ended (an expired reservation never checked out) does not make
 * this booking short. Once now reaches `to`, nothing is left: the window is
 * the empty `[now, now)`, no competing hold counts, and only units waiting on
 * UNASSIGNED stay short.
 *
 * Pure: no database access.
 *
 * @see {@link file://./booking-sources.server.ts} `getSliceSourceSummaries`, `dispatchUnits`
 */

import type { Window } from "./types";

/** What {@link shortageWindow} returns. */
export type ShortageWindow = {
  /** The window to measure over, half-open. */
  window: Window;
  /** True when nothing is left of the booking's window. */
  over: boolean;
};

/**
 * The window a booking's sources are judged short over: what is left of its
 * stored window at `now`.
 *
 * @param booking - The booking's stored start and end
 * @param now - The current time
 * @returns `[max(from, now), to)`, or `[now, now)` with `over` once now
 *   reaches `to`
 */
export function shortageWindow(
  booking: { from: Date; to: Date },
  now: Date
): ShortageWindow {
  if (now.getTime() >= booking.to.getTime()) {
    return { window: { from: now, to: now }, over: true };
  }
  return {
    window: {
      from: new Date(Math.max(booking.from.getTime(), now.getTime())),
      to: booking.to,
    },
    over: false,
  };
}
