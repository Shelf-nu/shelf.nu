/**
 * Asset Availability Primitives (dependency-free leaf)
 *
 * The pure, I/O-light core of the QT-availability domain: the interval-sweep
 * primitive ({@link peakConcurrent}), the shared active-booking filters
 * ({@link buildActiveBookingWhere} / {@link resolveIntervalTo} and their
 * status/category constants), and the stock-lowering write guard
 * ({@link assertAssetQuantityNotBelowReservations}).
 *
 * ## Why this file exists — breaking an import cycle
 *
 * These symbols USED to live in `./availability.server`. They were split out
 * because `~/modules/consumption-log/service.server` needs the stock-lowering
 * guard, and importing it from `availability.server` drags in that module's
 * heavy edges: `availability.server` imports `booking/service.server`
 * (`computeCheckedOutForAsset`) and `consumption-log` itself
 * (`computeAvailableQuantity`). The resulting cycle
 * `consumption-log → availability.server → booking/service.server →
 * consumption-log` corrupts Vitest partial-mock bindings: during the booking
 * suite's `importOriginal()` of `consumption-log`, `booking/service.server`
 * re-evaluates and captures the REAL `createConsumptionLog` before the mock is
 * installed, so every check-in disposition test sees zero mock calls.
 *
 * This leaf imports NEITHER `booking/service.server` NOR `consumption-log`
 * (only `@prisma/client` enums, `~/utils/error`, and TYPE-only shapes from
 * `availability.server`, which are erased at build time), so `consumption-log`
 * can import the guard from here without forming a runtime cycle.
 * `availability.server` re-exports everything here, so every existing consumer
 * keeps importing these symbols from `~/modules/asset/availability.server`
 * unchanged.
 *
 * @see {@link file://./availability.server.ts} — the public entrypoint that re-exports these.
 */

import type { Prisma } from "@prisma/client";
import { BookingStatus, ConsumptionCategory } from "@prisma/client";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

import type {
  AssetAvailabilityWindow,
  AvailabilityBatchClient,
} from "./availability.server";

const label: ErrorLabel = "Assets";

/**
 * "No known return date" sentinel used as an OVERDUE booking's effective
 * interval `to` (see {@link resolveIntervalTo}) — JS's maximum representable
 * `Date` (`+275760-09-13`), i.e. as close to "forever" as `Date` allows. Using
 * an actual `Date` (rather than e.g. `Infinity`) keeps
 * {@link peakConcurrent}'s `.getTime()` sweep uniform across every interval.
 */
const FAR_FUTURE_SENTINEL = new Date(8_640_000_000_000_000);

/* -------------------------------------------------------------------------- */
/*                               peakConcurrent                               */
/* -------------------------------------------------------------------------- */

/**
 * A committed booking interval competing for an asset's pool. Exported so
 * sibling batched primitives (e.g.
 * `~/modules/booking/stock-conflicts.server`) that build their own interval
 * lists from a differently-shaped query can type them identically to what
 * {@link peakConcurrent} / {@link overCommittedWindows} expect, without
 * redeclaring the shape.
 */
export type AvailabilityInterval = { from: Date; to: Date; qty: number };

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

/**
 * Booking statuses that claim availability for a given asset. Exported so
 * sibling primitives that need to test "is this booking active" against the
 * same definition (e.g. `flagBookingStockConflicts`'s eligibility filter in
 * `~/modules/booking/stock-conflicts.server`) never drift from what actually
 * competes for the pool here.
 */
export const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
] as const;

/**
 * Disposition categories that reduce a booking's remaining reserved
 * quantity. Exported so sibling batched primitives building their own
 * logged-dispositions read (e.g.
 * `~/modules/booking/stock-conflicts.server`) filter on the identical set —
 * see {@link RESERVATION_REDUCING_CATEGORIES}'s usage below for the
 * canonical shape of that query.
 */
export const RESERVATION_REDUCING_CATEGORIES = [
  ConsumptionCategory.RETURN,
  ConsumptionCategory.CONSUME,
  ConsumptionCategory.LOSS,
  ConsumptionCategory.DAMAGE,
] as const;

/**
 * Builds the shared `booking` where-filter for a reserved-rows query — used
 * identically by {@link getAssetAvailability} and
 * {@link getAssetAvailabilityBatch} so the two primitives can never drift on
 * which bookings compete for the pool.
 *
 * Built separately (rather than as one literal) so we can conditionally add
 * the `OR` without spreading through the `XOR<BookingScalarRelationFilter,
 * BookingWhereInput>` union Prisma generates for `BookingAssetWhereInput.booking`
 * (spreading that union type back into itself types `OR` as `never` on one
 * branch).
 *
 * With a `window`: RESERVED/ONGOING bookings are windowed by date-overlap
 * (`[from, to]` intersects `window`); OVERDUE bookings are included
 * UNCONDITIONALLY — an overdue-not-returned unit has no known return date, so
 * it must be considered for every window, not just ones whose dates happen to
 * overlap its stale `to` (paired with {@link resolveIntervalTo}'s sentinel
 * `to` on the interval side). Without a `window`, every active reservation is
 * included (today's behavior, informational sum).
 *
 * Exported so sibling batched primitives that need "every active booking for
 * these assets" without a per-target-booking window (e.g.
 * `flagBookingStockConflicts` in `~/modules/booking/stock-conflicts.server`,
 * which sweeps ALL active reservations for an asset rather than windowing
 * around one booking) can call this with `window: null` instead of
 * re-deriving the same status/org filter.
 *
 * @param organizationId - Caller's organization — scopes the reservation lookup.
 * @param window - Optional booking window to filter RESERVED/ONGOING bookings by.
 * @returns The `Prisma.BookingWhereInput` to nest under `bookingAsset.booking`.
 */
export function buildActiveBookingWhere(
  organizationId: string,
  window: AssetAvailabilityWindow
): Prisma.BookingWhereInput {
  const bookingWhere: Prisma.BookingWhereInput = {
    organizationId,
    status: { in: [...ACTIVE_BOOKING_STATUSES] },
  };
  if (window) {
    bookingWhere.OR = [
      { status: BookingStatus.OVERDUE },
      {
        AND: [{ from: { lte: window.to } }, { to: { gte: window.from } }],
      },
    ];
  }
  return bookingWhere;
}

/**
 * Resolves the effective `to` timestamp for a reserved row's
 * {@link AvailabilityInterval} in the peak-concurrent sweep.
 *
 * RESERVED/ONGOING bookings keep their REAL `to` (or the query window's `to`
 * when the row's own booking is unexpectedly missing dates — the same
 * conservative fallback used for `from`) — a unit is only occupied while the
 * booking is actually scheduled/active, so a booking that already ended
 * before the target window starts correctly stops competing for the pool.
 *
 * OVERDUE bookings have blown past their `to` with no logged return — there
 * is no known date they stop competing, so they get
 * {@link FAR_FUTURE_SENTINEL} instead, keeping them "occupying" every
 * current/future window until an explicit check-in changes their status.
 *
 * Exported so sibling primitives building their own interval lists from a
 * global (unwindowed) active-bookings read — e.g.
 * `flagBookingStockConflicts` in `~/modules/booking/stock-conflicts.server`
 * — resolve the OVERDUE sentinel identically instead of re-deriving it.
 *
 * @param bookingStatus - The reserving booking's status, if known.
 * @param bookingTo - The reserving booking's real `to` date, if known.
 * @param windowTo - The query window's `to` — conservative fallback only.
 * @returns The `to` timestamp to use for this row's interval.
 */
export function resolveIntervalTo(
  bookingStatus: BookingStatus | undefined,
  bookingTo: Date | undefined,
  windowTo: Date
): Date {
  if (bookingStatus === BookingStatus.OVERDUE) return FAR_FUTURE_SENTINEL;
  return bookingTo ?? windowTo;
}

/* -------------------------------------------------------------------------- */
/*                 assertAssetQuantityNotBelowReservations                    */
/* -------------------------------------------------------------------------- */

/** Arguments for {@link assertAssetQuantityNotBelowReservations}. */
type AssertAssetQuantityNotBelowReservationsArgs = {
  /** The QUANTITY_TRACKED asset whose total `quantity` is being lowered. */
  assetId: string;
  /** Caller's organization — scopes every custody/kit/reservation query. */
  organizationId: string;
  /**
   * Prisma transaction the guard's reads must run inside, so the check
   * commits atomically with the mutation lowering `Asset.quantity`.
   */
  tx: AssertAssetQuantityNotBelowReservationsTxClient;
  /** The asset's total quantity as it would be AFTER this write. */
  newTotal: number;
  /** Asset title, used in the rejection message + `additionalData`. */
  assetTitle?: string;
  /** Asset's unit of measure, used in the rejection message. */
  unitOfMeasure?: string | null;
};

/**
 * Minimal Prisma surface {@link assertAssetQuantityNotBelowReservations}
 * needs — a `Pick` of {@link AvailabilityBatchClient} (only the delegates
 * this guard actually queries: `custody`, `assetKit`, `bookingAsset`,
 * `consumptionLog`) rather than the full batch-client surface. Mirrors how
 * `~/modules/booking/stock-conflicts.server`'s `StockConflictDbClient` reuses
 * the same batch-client shape without pulling in methods it never calls
 * (`asset.findMany`, `partialBookingCheckout.findMany` — this guard doesn't
 * need the asset's own `quantity` row or partial-checkout sessions, only
 * what's currently committed against it).
 */
export type AssertAssetQuantityNotBelowReservationsTxClient = Pick<
  AvailabilityBatchClient,
  "custody" | "assetKit" | "bookingAsset" | "consumptionLog"
>;

/**
 * STOCK-LOWERING guard: blocks reducing a QUANTITY_TRACKED asset's total
 * `quantity` below what is ALREADY committed elsewhere — operator custody,
 * kit allocations, or an overlapping active booking. Without this guard, an
 * admin editing the asset overview (or a CSV update-existing import, which
 * routes through the same `updateAsset` call) could shrink the pool
 * underneath commitments that already exist, silently leaving custody/kit
 * rows or a booking's reserved slice referencing more units than the asset
 * now has.
 *
 * This is the MIRROR-IMAGE guard to {@link assertAssetQuantityAvailable} /
 * {@link assertAssetQuantitiesAvailable}: those police a BOOKING's requested
 * quantity against the asset's pool (asset total held fixed); this one
 * polices the ASSET's total itself against everything already drawing from
 * that pool (bookings/kits/custody held fixed).
 *
 * The threshold is a COMMITTED PEAK, not a sum:
 * ```
 * committed = inCustody + inKits + peakConcurrent(reservedIntervals)
 * ```
 * `inCustody` is operator custody right now (`kitCustodyId IS NULL`);
 * `inKits` is Σ `AssetKit.quantity`; the booking term is the PEAK concurrent
 * demand (via {@link peakConcurrent}) across every ACTIVE (RESERVED/ONGOING/
 * OVERDUE) STANDALONE (`assetKitId: null`) reservation for this asset — two
 * bookings that never overlap must not stack (the same bb1/bb2 model
 * {@link getAssetAvailability} uses; a naive sum would reject a perfectly
 * safe reduction). Deliberately UNWINDOWED — this guard protects the asset's
 * WHOLE FUTURE TIMELINE, not one booking's dates, so every active
 * reservation is fetched via {@link buildActiveBookingWhere} with
 * `window: null` (OVERDUE included unconditionally, sentinel-extended via
 * {@link resolveIntervalTo} so an unreturned unit keeps counting against
 * every future instant). Each reservation's `qty` is the booked amount minus
 * already-logged {@link RESERVATION_REDUCING_CATEGORIES} dispositions,
 * exactly as every other availability read in this module computes it.
 *
 * A reduction to EXACTLY `committed` is allowed — only `newTotal < committed`
 * rejects, since the pool is fully (not over-) subscribed at that total.
 *
 * Runs a FIXED small number of queries (custody + kits + reserved rows in
 * parallel, plus one more for logged dispositions ONLY when there are
 * reserved rows to net against) regardless of how many bookings/kits/custody
 * rows exist for the asset — no per-booking fan-out.
 *
 * Call inside the mutation's own transaction, with the asset already behind
 * `lockAssetForQuantityUpdate`, so the read-then-decide is race-safe (same
 * contract as {@link assertAssetQuantityAvailable}).
 *
 * @param args - See {@link AssertAssetQuantityNotBelowReservationsArgs}.
 * @throws {ShelfError} 400 (`shouldBeCaptured: false`) when `newTotal` would drop below `committed`.
 */
export async function assertAssetQuantityNotBelowReservations({
  assetId,
  organizationId,
  tx,
  newTotal,
  assetTitle,
  unitOfMeasure,
}: AssertAssetQuantityNotBelowReservationsArgs): Promise<void> {
  const [custodyGroups, inKitsGroups, reservedRows] = await Promise.all([
    tx.custody.groupBy({
      by: ["assetId"],
      // Custody has no `organizationId` column of its own — scope through
      // the asset relation, mirroring `getAssetAvailabilityBatch`'s
      // identical org-scope guard (org-scope-user-supplied-ids rule).
      where: { assetId, asset: { organizationId } },
      _sum: { quantity: true },
    }),
    tx.assetKit.groupBy({
      by: ["assetId"],
      where: { assetId, organizationId },
      _sum: { quantity: true },
    }),
    tx.bookingAsset.findMany({
      where: {
        assetId,
        // Kit-driven slices are already counted via `inKits` — summing them
        // here too would double-count the same units.
        assetKitId: null,
        // `window: null` — the asset's FULL active-reservation timeline, not
        // just one booking's dates. We're protecting every future instant
        // this asset could be drawn from, not a single window.
        booking: buildActiveBookingWhere(organizationId, null),
      },
      select: {
        assetId: true,
        bookingId: true,
        quantity: true,
        booking: { select: { from: true, to: true, status: true } },
      },
    }),
  ]);

  const inCustody = custodyGroups[0]?._sum.quantity ?? 0;
  const inKits = inKitsGroups[0]?._sum.quantity ?? 0;

  let peakReserved = 0;
  if (reservedRows.length > 0) {
    const bookingIds = [...new Set(reservedRows.map((r) => r.bookingId))];

    // Mirrors every other availability read's logged-dispositions query —
    // RETURN/CONSUME/LOSS/DAMAGE reduce a booking's remaining reserved
    // footprint before it competes for the pool.
    const loggedGroups = await tx.consumptionLog.groupBy({
      by: ["bookingId", "assetId"],
      where: {
        assetId,
        bookingId: { in: bookingIds },
        category: { in: [...RESERVATION_REDUCING_CATEGORIES] },
      },
      _sum: { quantity: true },
    });

    const loggedByBookingId = new Map<string, number>();
    for (const group of loggedGroups) {
      if (group.bookingId) {
        loggedByBookingId.set(group.bookingId, group._sum.quantity ?? 0);
      }
    }

    const intervals: AvailabilityInterval[] = [];
    for (const row of reservedRows) {
      // Defensive only: `Booking` is a required (non-nullable) relation on
      // `BookingAsset`, so a row with no `booking` should never occur.
      if (!row.booking) continue;

      const logged = loggedByBookingId.get(row.bookingId) ?? 0;
      // Clamp at 0 per row, same defence-in-depth as every other primitive
      // in this module — an over-logged booking can't push demand negative.
      const remaining = Math.max(0, row.quantity - logged);
      if (remaining === 0) continue;

      // `windowTo` fallback is unreachable here (`row.booking.to` is always
      // defined whenever `row.booking` is) — passed through only to satisfy
      // `resolveIntervalTo`'s signature, mirroring
      // `flagBookingStockConflicts`'s identical unwindowed sweep in
      // `~/modules/booking/stock-conflicts.server`.
      const to = resolveIntervalTo(
        row.booking.status,
        row.booking.to,
        row.booking.to
      );
      intervals.push({ from: row.booking.from, to, qty: remaining });
    }

    // PEAK, not sum — two bookings that never overlap must not stack and
    // inflate the threshold above what the pool is ever actually holding at
    // once (the bb1/bb2 model).
    peakReserved = peakConcurrent(intervals);
  }

  const committed = inCustody + inKits + peakReserved;

  if (newTotal < committed) {
    const title = assetTitle ?? "This asset";
    const unit = unitOfMeasure || "units";
    throw new ShelfError({
      cause: null,
      title: "Cannot reduce quantity below commitments",
      message: `Cannot reduce "${title}" to ${newTotal} ${unit} — ${committed} ${unit} are committed (custody, kits, or overlapping bookings). Release or reduce those first.`,
      additionalData: {
        assetId,
        organizationId,
        newTotal,
        inCustody,
        inKits,
        peakReserved,
        committed,
      },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
}
