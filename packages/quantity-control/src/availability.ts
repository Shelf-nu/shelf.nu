/**
 * `@shelf/quantity-control` — availability primitives.
 *
 * The pure, I/O-free core of the QT-availability domain, extracted from the
 * webapp's `asset/availability-primitives.server.ts` and the availability
 * formula in `asset/availability.server.ts`:
 *
 *   - {@link peakConcurrent} — end-exclusive interval sweep → peak demand.
 *   - {@link overCommittedWindows} — the sibling sweep that returns the time
 *     RANGES (with each range's peak) where concurrent demand exceeds a total.
 *   - {@link resolveIntervalTo} — OVERDUE → far-future sentinel, else real `to`.
 *   - {@link computeAvailability} — the signed `physicalAvailable` / `bookable`
 *     formula from already-resolved {@link AvailabilityInputs}.
 *   - {@link ACTIVE_BOOKING_STATUSES} / {@link RESERVATION_REDUCING_CATEGORIES}
 *     — the shared status/category constants the webapp's Prisma `where`
 *     builders (`buildActiveBookingWhere`, which STAYS in the webapp because it
 *     is Prisma-coupled) build their `{ in: [...] }` filters from.
 *
 * ## Windowed-occupancy model
 *
 * A checked-out unit is NOT gone forever — it is expected back by its
 * booking's `to`. RESERVED and ONGOING bookings therefore compete for the
 * pool only while their real `[from, to)` window is relevant; a booking that
 * ended before the target window starts does not reduce it. OVERDUE is the
 * exception: with no logged return there is no known date it stops competing,
 * so {@link resolveIntervalTo} extends it to {@link FAR_FUTURE_SENTINEL}.
 * `checkedOut` feeds ONLY `physicalAvailable`; it is deliberately NOT
 * subtracted a second time in `bookable` (ONGOING/OVERDUE occupancy is
 * already captured by `reservedPeak`'s windowed sweep).
 *
 * @see {@link file://./types.ts}
 */

import type {
  AvailabilityBreakdown,
  AvailabilityInputs,
  AvailabilityInterval,
  QtBookingStatus,
  QtConsumptionCategory,
} from "./types.js";

/**
 * "No known return date" sentinel used as an OVERDUE booking's effective
 * interval `to` (see {@link resolveIntervalTo}) — JS's maximum representable
 * `Date` (`+275760-09-13`), i.e. as close to "forever" as `Date` allows. Using
 * an actual `Date` (rather than e.g. `Infinity`) keeps {@link peakConcurrent}'s
 * `.getTime()` sweep uniform across every interval.
 */
export const FAR_FUTURE_SENTINEL = new Date(8_640_000_000_000_000);

/**
 * Booking statuses that claim availability for a given asset — the only
 * statuses whose reservations compete for the pool. The webapp's
 * `buildActiveBookingWhere` builds its `status: { in: [...] }` from these.
 */
export const ACTIVE_BOOKING_STATUSES = [
  "RESERVED",
  "ONGOING",
  "OVERDUE",
] as const satisfies readonly QtBookingStatus[];

/**
 * Disposition categories that reduce a booking's remaining reserved quantity
 * before it competes for the pool. CHECKOUT is intentionally excluded — it is
 * a custody handoff, not a reduction of the reservation footprint.
 */
export const RESERVATION_REDUCING_CATEGORIES = [
  "RETURN",
  "CONSUME",
  "LOSS",
  "DAMAGE",
] as const satisfies readonly QtConsumptionCategory[];

/* -------------------------------------------------------------------------- */
/*                               peakConcurrent                               */
/* -------------------------------------------------------------------------- */

/**
 * Maximum concurrent committed quantity at any instant across `intervals`.
 *
 * Runs an O(n log n) sweep: each interval contributes a +qty event at `from`
 * and a −qty event at `to`. Ends are applied before starts at an identical
 * timestamp, so a booking that ends exactly when another begins is treated as
 * non-overlapping (end-exclusive). This is what fixes the "bb1/bb2 bug":
 * naively summing every reservation in a window double-counts bookings that
 * never actually overlap in time.
 *
 * @param intervals - committed booking intervals (already filtered to the target window)
 * @returns the peak concurrent quantity (0 for empty input)
 */
export function peakConcurrent(intervals: AvailabilityInterval[]): number {
  const events: Array<{ t: number; delta: number }> = [];
  for (const { from, to, qty } of intervals) {
    events.push({ t: from.getTime(), delta: qty });
    events.push({ t: to.getTime(), delta: -qty });
  }
  // Sort by time; at equal timestamps apply releases (−) before claims (+)
  // so a booking ending exactly when another starts never appears to overlap.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  let running = 0;
  let peak = 0;
  for (const { delta } of events) {
    running += delta;
    if (running > peak) peak = running;
  }
  return peak;
}

/* -------------------------------------------------------------------------- */
/*                            overCommittedWindows                            */
/* -------------------------------------------------------------------------- */

/**
 * Sibling sweep to {@link peakConcurrent}: instead of collapsing the whole
 * timeline down to a single peak number, returns every time RANGE where the
 * running concurrent quantity is STRICTLY GREATER than `total` (a genuine
 * over-commitment, not merely "at capacity"), each tagged with the peak level
 * reached inside that range. Empty when the running sum never exceeds `total`.
 *
 * Runs the identical O(n log n) event-sweep as {@link peakConcurrent} — same
 * events, same tie-break (releases before claims at an identical timestamp) —
 * but walks the timeline in timestamp-grouped batches (every event sharing an
 * exact instant is folded in before the level is tested) and records the
 * `[from, to)` span of every contiguous stretch where the level exceeds
 * `total`, along with the maximum level reached during the stretch. Adjacent
 * over-committed spans that touch merge into one window because the level
 * never dips back to `total` or below in between.
 *
 * @param intervals - committed booking intervals (already filtered to the pool in question)
 * @param total - the asset's total quantity; the threshold intervals must NOT exceed
 * @returns the `[from, to)` ranges where demand exceeded `total`, each with its `peak`
 */
export function overCommittedWindows(
  intervals: AvailabilityInterval[],
  total: number
): Array<{ from: Date; to: Date; peak: number }> {
  const events: Array<{ t: number; delta: number }> = [];
  for (const { from, to, qty } of intervals) {
    events.push({ t: from.getTime(), delta: qty });
    events.push({ t: to.getTime(), delta: -qty });
  }
  // Same tie-break as peakConcurrent: releases (−) before claims (+) at an
  // identical timestamp.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const windows: Array<{ from: Date; to: Date; peak: number }> = [];
  let running = 0;
  // Timestamp (ms) the current over-committed window started, or `null` when
  // the running level is currently at-or-below `total`.
  let overSince: number | null = null;
  // The highest running level observed since `overSince` — the window's peak.
  let windowPeak = 0;

  let i = 0;
  while (i < events.length) {
    const t = events[i].t;
    // Fold in every event sharing this exact instant before testing the level.
    while (i < events.length && events[i].t === t) {
      running += events[i].delta;
      i++;
    }

    if (running > total) {
      if (overSince === null) {
        overSince = t;
        windowPeak = running;
      } else if (running > windowPeak) {
        windowPeak = running;
      }
    } else if (overSince !== null) {
      windows.push({
        from: new Date(overSince),
        to: new Date(t),
        peak: windowPeak,
      });
      overSince = null;
      windowPeak = 0;
    }
  }

  // Every interval contributes a matching +qty/−qty pair, so the running sum
  // always returns to 0 (≤ total) by the final event — no open window remains.
  return windows;
}

/* -------------------------------------------------------------------------- */
/*                             resolveIntervalTo                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the effective `to` timestamp for a reserved row's
 * {@link AvailabilityInterval} in the peak-concurrent sweep.
 *
 * RESERVED/ONGOING bookings keep their REAL `to` (or the query window's `to`
 * when the row's own booking is unexpectedly missing dates — the conservative
 * fallback). OVERDUE bookings have blown past their `to` with no logged
 * return, so there is no known date they stop competing: they get
 * {@link FAR_FUTURE_SENTINEL} instead, keeping them "occupying" every
 * current/future window until an explicit check-in changes their status.
 *
 * @param bookingStatus - The reserving booking's status, if known.
 * @param bookingTo - The reserving booking's real `to` date, if known.
 * @param windowTo - The query window's `to` — conservative fallback only.
 * @returns The `to` timestamp to use for this row's interval.
 */
export function resolveIntervalTo(
  bookingStatus: QtBookingStatus | undefined,
  bookingTo: Date | undefined,
  windowTo: Date
): Date {
  if (bookingStatus === "OVERDUE") return FAR_FUTURE_SENTINEL;
  return bookingTo ?? windowTo;
}

/* -------------------------------------------------------------------------- */
/*                            computeAvailability                             */
/* -------------------------------------------------------------------------- */

/**
 * Turns already-resolved pool components ({@link AvailabilityInputs}) into the
 * two signed headline figures. The webapp adapter runs the Prisma queries +
 * row locks, maps rows into `AvailabilityInputs`, and calls this — the exact
 * formula that previously lived inline in `getAssetAvailability`:
 *
 * ```
 * physicalAvailable = total − inCustody − inKits − checkedOut
 * bookable          = total − inCustody − inKits − reservedPeak
 * ```
 *
 * Both are **signed** (never clamped here). `checkedOut` feeds ONLY
 * `physicalAvailable`; `bookable` subtracts `reservedPeak` instead — ONGOING/
 * OVERDUE occupancy is already captured in the peak sweep, so subtracting
 * `checkedOut` again would double-count it (the original modeling bug).
 *
 * @param inputs - The resolved pool components.
 * @returns The signed {@link AvailabilityBreakdown}.
 */
export function computeAvailability(
  inputs: AvailabilityInputs
): AvailabilityBreakdown {
  const { total, inCustody, inKits, reservedPeak, checkedOut } = inputs;
  const physicalAvailable = total - inCustody - inKits - checkedOut;
  const bookable = total - inCustody - inKits - reservedPeak;
  return { physicalAvailable, bookable };
}
