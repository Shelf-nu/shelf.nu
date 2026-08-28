/**
 * Asset Availability Primitives (dependency-free leaf)
 *
 * The Prisma-COUPLED core of the QT-availability domain that cannot live in
 * the pure `@shelf/quantity-control` package: the shared active-booking
 * `where`-builder ({@link buildActiveBookingWhere}) and the stock-lowering
 * write guard ({@link assertAssetQuantityNotBelowReservations}). The pure math
 * these rely on — the interval-sweep primitive, the OVERDUE-sentinel `to`
 * resolver, the status/category constants, and the committed-total verdict —
 * is now owned by `@shelf/quantity-control` and imported here (and re-exported
 * below so every existing consumer's import path stays stable).
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
 * (only the dependency-free `@shelf/quantity-control` package, `@prisma/client`
 * enums, `~/utils/error`, and TYPE-only shapes from `availability.server`,
 * which are erased at build time), so `consumption-log` can import the guard
 * from here without forming a runtime cycle. `availability.server` re-exports
 * everything here, so every existing consumer keeps importing these symbols
 * from `~/modules/asset/availability.server` unchanged.
 *
 * @see {@link file://./availability.server.ts} — the public entrypoint that re-exports these.
 * @see {@link file://../../../../packages/quantity-control/src/availability.ts} — the pure primitives.
 */

import type { Prisma } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import {
  ACTIVE_BOOKING_STATUSES,
  checkQuantityNotBelowCommitted,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
} from "@shelf/quantity-control";
import type { AvailabilityInterval } from "@shelf/quantity-control";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

import type {
  AssetAvailabilityWindow,
  AvailabilityBatchClient,
} from "./availability.server";

const label: ErrorLabel = "Assets";

// The pure availability primitives now live in `@shelf/quantity-control`.
// Re-exported here (unchanged values) so `availability.server` — and, through
// its own re-export, every downstream consumer — keeps importing them from the
// `~/modules/asset/...` path they always have, with no call-site churn.
export {
  ACTIVE_BOOKING_STATUSES,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
};
export type { AvailabilityInterval };

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
        // STRICT (half-open) overlap: `from < window.to` AND `to > window.from`.
        // The peak-concurrent sweep is end-exclusive (a booking ending exactly
        // when another begins never overlaps — see `peakConcurrent`'s tie-break),
        // so the fetch predicate must match: an inclusive `lte`/`gte` would pull
        // in a back-to-back booking that ends exactly at `window.from` (or starts
        // exactly at `window.to`), and because the sweep uses that booking's own
        // interval it would contribute its full quantity to the peak and make a
        // legitimately-available back-to-back booking look out of stock.
        AND: [{ from: { lt: window.to } }, { to: { gt: window.from } }],
      },
    ];
  }
  return bookingWhere;
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
/**
 * The two reads {@link getPeakReservedUnitsByAsset} issues.
 *
 * Structural, and declared here rather than widened out of the shared
 * availability client: the `groupBy` needs `bookingAssetId` in its `by`, which
 * the shared client does not expose, and broadening that type reaches every
 * other availability read.
 */
export type PeakReservedTxClient = {
  bookingAsset: {
    findMany: (args: {
      where: Prisma.BookingAssetWhereInput;
      select: {
        id: true;
        assetId: true;
        bookingId: true;
        quantity: true;
        assetKitId: true;
        booking: { select: { from: true; to: true; status: true } };
      };
    }) => Promise<
      Array<{
        id: string;
        assetId: string;
        bookingId: string;
        quantity: number;
        assetKitId: string | null;
        booking: { from: Date; to: Date; status: BookingStatus } | null;
      }>
    >;
  };
  consumptionLog: {
    groupBy: (args: {
      by: ["bookingAssetId", "bookingId", "assetId"];
      where: Prisma.ConsumptionLogWhereInput;
      _sum: { quantity: true };
    }) => Promise<
      Array<{
        bookingAssetId: string | null;
        bookingId: string | null;
        assetId: string;
        _sum: { quantity: number | null };
      }>
    >;
  };
};

/**
 * Peak concurrent standalone reserved units, per asset, across the whole
 * future timeline.
 *
 * This is the booking term for anything holding units WITHOUT dates of its
 * own — a kit slice, or the asset's own total. Such a holder has to survive
 * every future instant, so what it competes against is the highest demand at
 * any one moment, not the sum of every reservation: two bookings that never
 * overlap never hold units at the same time, and stacking them would refuse
 * allocations that are perfectly safe.
 *
 * Batched because the kit picker asks about a page of assets at once; the
 * single-asset guard below asks the same question of one.
 *
 * Only STANDALONE reservations enter the peak — kit-driven slices are counted
 * through `AssetKit.quantity` by every caller of this, and would otherwise be
 * subtracted twice.
 *
 * Already-logged {@link RESERVATION_REDUCING_CATEGORIES} dispositions reduce a
 * booking's remaining footprint first. They are attributed per
 * `BookingAsset` ROW: one (booking, asset) pair can hold a standalone slice
 * and kit-driven ones at once, so a return logged against a kit slice must not
 * shrink the standalone reservation this guard is protecting. Dispositions
 * predating per-row attribution carry no row id and fill kit-driven slices
 * first, per `ConsumptionLog.bookingAssetId`.
 *
 * @param args.assetIds - Assets to compute for. Empty issues no queries.
 * @param args.organizationId - Caller's organization; scopes every read
 * @param args.tx - Prisma client or active transaction
 * @returns Peak reserved units keyed by asset id; absent means zero
 */
export async function getPeakReservedUnitsByAsset({
  assetIds,
  organizationId,
  tx,
}: {
  assetIds: string[];
  organizationId: string;
  tx: PeakReservedTxClient;
}): Promise<Map<string, number>> {
  const peaks = new Map<string, number>();
  if (assetIds.length === 0) return peaks;

  // Both kinds of row are fetched, not just standalone. Kit-driven rows are
  // never summed into the peak — they are counted through `AssetKit.quantity`
  // by every caller — but they are needed to place legacy dispositions, which
  // attribute kit-driven-first (see `ConsumptionLog.bookingAssetId`).
  const rows = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: assetIds },
      // `window: null` — the full active-reservation timeline, because the
      // holder asking has no window of its own.
      booking: buildActiveBookingWhere(organizationId, null),
    },
    select: {
      id: true,
      assetId: true,
      bookingId: true,
      quantity: true,
      assetKitId: true,
      booking: { select: { from: true, to: true, status: true } },
    },
  });

  if (rows.length === 0) return peaks;

  const loggedGroups = await tx.consumptionLog.groupBy({
    by: ["bookingAssetId", "bookingId", "assetId"],
    where: {
      assetId: { in: assetIds },
      bookingId: { in: [...new Set(rows.map((r) => r.bookingId))] },
      category: { in: [...RESERVATION_REDUCING_CATEGORIES] },
    },
    _sum: { quantity: true },
  });

  /** Dispositions attributed to one specific `BookingAsset` row. */
  const loggedByRowId = new Map<string, number>();
  /**
   * Dispositions from before per-row attribution existed, keyed by the
   * (booking, asset) pair they belong to. These have to be placed by hand.
   */
  const legacyLoggedByPair = new Map<string, number>();

  for (const group of loggedGroups) {
    const quantity = group._sum.quantity ?? 0;
    if (quantity === 0) continue;

    if (group.bookingAssetId) {
      loggedByRowId.set(
        group.bookingAssetId,
        (loggedByRowId.get(group.bookingAssetId) ?? 0) + quantity
      );
      continue;
    }

    if (!group.bookingId) continue;
    const pair = `${group.bookingId}:${group.assetId}`;
    legacyLoggedByPair.set(
      pair,
      (legacyLoggedByPair.get(pair) ?? 0) + quantity
    );
  }

  // Legacy dispositions fill kit-driven slices before standalone ones, so a
  // pair's kit-driven capacity absorbs them first and only the remainder
  // reaches the standalone row. Attributing the whole legacy total to the
  // standalone row would shrink the reservation this guard is protecting.
  const legacyForStandalone = new Map<string, number>();
  for (const [pair, legacyQuantity] of legacyLoggedByPair) {
    // What the kit slices can still absorb, not what they hold: a kit row
    // whose units were already returned under its own row id has nothing left
    // to soak up, and treating its full quantity as capacity would swallow the
    // legacy total before any of it reached the standalone row.
    const kitDrivenCapacity = rows
      .filter(
        (r) => r.assetKitId !== null && `${r.bookingId}:${r.assetId}` === pair
      )
      .reduce(
        (sum, r) =>
          sum + Math.max(0, r.quantity - (loggedByRowId.get(r.id) ?? 0)),
        0
      );

    legacyForStandalone.set(
      pair,
      Math.max(0, legacyQuantity - kitDrivenCapacity)
    );
  }

  const intervalsByAsset = new Map<string, AvailabilityInterval[]>();
  for (const row of rows) {
    // Kit-driven slices are counted through `AssetKit.quantity`; summing them
    // here too would subtract the same units twice.
    if (row.assetKitId !== null) continue;
    if (!row.booking) continue;

    const pair = `${row.bookingId}:${row.assetId}`;
    const logged =
      (loggedByRowId.get(row.id) ?? 0) + (legacyForStandalone.get(pair) ?? 0);
    const remaining = Math.max(0, row.quantity - logged);
    if (remaining === 0) continue;

    const to = resolveIntervalTo(
      row.booking.status,
      row.booking.to,
      row.booking.to
    );

    const intervals = intervalsByAsset.get(row.assetId) ?? [];
    intervals.push({ from: row.booking.from, to, qty: remaining });
    intervalsByAsset.set(row.assetId, intervals);
  }

  for (const [assetId, intervals] of intervalsByAsset) {
    peaks.set(assetId, peakConcurrent(intervals));
  }

  return peaks;
}

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
      // `kitCustodyId: null` = OPERATOR custody only — kit-inherited custody is
      // already counted via `AssetKit.quantity` (`inKits` below), so including
      // it here would double-count against the committed threshold.
      where: { assetId, asset: { organizationId }, kitCustodyId: null },
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

  // Route only the FINAL numeric decision through the pure package verdict
  // (`newTotal < committed` ⟺ `!verdict.ok`). The thrown `ShelfError` — its
  // message copy and `additionalData` breakdown — stays built here so the
  // exact user-facing string and debugging payload are preserved byte-for-byte.
  if (!checkQuantityNotBelowCommitted({ newTotal, committed }).ok) {
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
