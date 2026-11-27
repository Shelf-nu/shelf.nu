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
 * enums, `~/utils/error`, the pure `booking/checkout-attribution` and
 * `booking/checkin-receipt` helpers, and TYPE-only shapes from `availability.server`, which are erased at build
 * time), so `consumption-log` can import the guard
 * from here without forming a runtime cycle. `availability.server` re-exports
 * everything here, so every existing consumer keeps importing these symbols
 * from `~/modules/asset/availability.server` unchanged.
 *
 * @see {@link file://./availability.server.ts} — the public entrypoint that re-exports these.
 * @see {@link file://../../../../packages/quantity-control/src/availability.ts} — the pure primitives.
 */

import type { BookingSourceAllocation, Prisma } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import {
  ACTIVE_BOOKING_STATUSES,
  checkQuantityNotBelowCommitted,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
} from "@shelf/quantity-control";
import type { AvailabilityInterval } from "@shelf/quantity-control";
import { resolveSentUnits } from "~/modules/booking/checkin-receipt";
import {
  attributeDispositionsByBookingAsset,
  type CheckoutAttributionLog,
} from "~/modules/booking/checkout-attribution";
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
 * The source-row read both pool readers issue for the standalone slices of
 * converted groups. Structural so the root client and an interactive
 * transaction both satisfy it.
 */
export type ConvertedSliceRowsClient = {
  bookingAssetSource: {
    findMany: (args: {
      where: { organizationId: string; bookingAssetId: { in: string[] } };
      select: { bookingAssetId: true; quantity: true; releasedQuantity: true };
    }) => Promise<
      Array<{
        bookingAssetId: string;
        quantity: number;
        releasedQuantity: number;
      }>
    >;
  };
};

/** Modes of a converted standalone slice: its source rows carry its demand. */
const CONVERTED_STANDALONE_MODES: ReadonlySet<BookingSourceAllocation> =
  new Set<BookingSourceAllocation>(["AUTO", "MANUAL"]);

/**
 * True when a slice belongs to a converted group. A row read without the
 * column (an older fixture or a narrower select) counts as LEGACY.
 *
 * A group is all LEGACY or has no LEGACY slice (conversion converts every
 * slice at once and a slice added later is KIT or AUTO), so one slice's mode
 * answers for its group. A group converted only through orphaned shares has
 * no slices left, so it contributes nothing to any reader here.
 */
export function isConvertedSlice(
  mode: BookingSourceAllocation | undefined
): boolean {
  return mode !== undefined && mode !== "LEGACY";
}

/**
 * Ids of the converted standalone slices among reserved rows, for
 * {@link loadRemainingReservationBySlice}. Rows must be standalone
 * (`assetKitId` NULL): a converted standalone slice is AUTO or MANUAL.
 *
 * @param rows - Standalone reserved rows with their id and mode
 * @returns The ids of the rows whose group is converted
 */
export function convertedStandaloneIds(
  rows: Array<{ id?: string; sourceAllocation?: BookingSourceAllocation }>
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.id !== undefined && isConvertedSlice(row.sourceAllocation)) {
      ids.push(row.id);
    }
  }
  return ids;
}

/**
 * Remaining reservation (`quantity - releasedQuantity`, UNASSIGNED rows
 * included) summed per slice, in one query. Issues no query for no slices.
 *
 * @param tx - Client or transaction
 * @param organizationId - Scopes the read through the rows' own column
 * @param sliceIds - AUTO / MANUAL slices of converted groups
 * @returns Units still held per slice id; absent means zero
 */
export async function loadRemainingReservationBySlice(
  tx: ConvertedSliceRowsClient,
  organizationId: string,
  sliceIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (sliceIds.length === 0) return result;
  const rows = await tx.bookingAssetSource.findMany({
    where: { organizationId, bookingAssetId: { in: sliceIds } },
    select: { bookingAssetId: true, quantity: true, releasedQuantity: true },
  });
  for (const row of rows) {
    result.set(
      row.bookingAssetId,
      (result.get(row.bookingAssetId) ?? 0) +
        Math.max(0, row.quantity - row.releasedQuantity)
    );
  }
  return result;
}

/**
 * Units one standalone reservation row still holds against the asset's pool.
 *
 * Two readings, and the larger one wins:
 * - what the row has not yet given back: `quantity - logged`. Before anything
 *   leaves this is the whole reservation, and each logged RETURN / CONSUME /
 *   LOSS / DAMAGE unit frees one.
 * - what is physically out right now: `checkedOutQuantity - logged`, capped at
 *   the row's quantity. `checkedOutQuantity` is cumulative, so a row that came
 *   back in full and went out again reads its second trip here while the first
 *   reading has already dropped to zero.
 *
 * `quantity - logged` alone would free units that are out again, and let a
 * total be set below them.
 *
 * @param row.quantity - `BookingAsset.quantity`, the booked units
 * @param row.checkedOutQuantity - `BookingAsset.checkedOutQuantity`, cumulative
 *   units sent out; null reads as none. Required, so a read that forgets to
 *   select the column fails to compile
 * @param logged - RESERVATION_REDUCING_CATEGORIES units attributed to the row
 * @returns Non-negative units, never more than `row.quantity`
 */
export function reservedUnitsStillHeld(
  row: { quantity: number; checkedOutQuantity: number | null },
  logged: number
): number {
  const notYetGivenBack = Math.max(0, row.quantity - logged);
  const outRightNow = Math.min(
    row.quantity,
    Math.max(0, (row.checkedOutQuantity ?? 0) - logged)
  );
  return Math.max(notYetGivenBack, outRightNow);
}

/** A `BookingAsset` row as {@link loggedUnitsByReservationRow} reads it. */
export type ReservationRowForAttribution = {
  /** Optional only so a read that cannot name its rows still type-checks. */
  id?: string;
  bookingId: string;
  /** Left out by a read that is already scoped to one asset. */
  assetId?: string;
  /** `null` or absent for a standalone slice, set for a kit-driven one. */
  assetKitId?: string | null;
  quantity: number;
  checkedOutAt?: Date | null;
  checkedOutQuantity?: number | null;
};

/** One `consumptionLog.groupBy` group, as the availability reads fetch it. */
export type LoggedUnitsGroup = {
  /** The slice the units were logged on; `null` or absent when none was named. */
  bookingAssetId?: string | null;
  bookingId: string | null;
  /** Left out by a read that is already scoped to one asset. */
  assetId?: string;
  _sum: { quantity: number | null };
};

/**
 * The {@link RESERVATION_REDUCING_CATEGORIES} units each reservation row has
 * given back, attributed per `BookingAsset` row.
 *
 * One (booking, asset) pair can hold a standalone slice and kit-driven ones at
 * once. Summing the pair's logs and taking them off every row would let a
 * return on the kit slice free the standalone slice while its units are out,
 * so every availability read sizes its rows through this.
 *
 * A log naming its row counts for that row. One naming none is placed by
 * {@link attributeDispositionsByBookingAsset}: standalone slice first, then
 * kit-driven ones in slice id order, each taking at most the units it sent
 * out ({@link resolveSentUnits}). That is the order and the capacity the
 * check-in writer and every booking surface use. A log loses its row when
 * the slice it named is removed from the booking, so the cap applies to a
 * booking's only row too: a row that never left takes none of them.
 *
 * Callers must pass EVERY row of each pair, kit-driven ones included, or an
 * untagged log has nowhere to go but the standalone slice. Kit-driven rows are
 * for attribution only: callers that count kit units through
 * `AssetKit.quantity` skip them when summing.
 *
 * @param rows - Reservation rows, all slices of each (booking, asset) pair
 * @param loggedGroups - Logged units grouped by slice, booking and asset
 * @returns Logged units per row, keyed by the row object passed in
 */
export function loggedUnitsByReservationRow<
  Row extends ReservationRowForAttribution,
>(rows: readonly Row[], loggedGroups: readonly LoggedUnitsGroup[]) {
  const pairKey = (bookingId: string, assetId: string | undefined) =>
    `${bookingId}:${assetId ?? ""}`;

  const rowsByPair = new Map<string, Row[]>();
  for (const row of rows) {
    const key = pairKey(row.bookingId, row.assetId);
    const pairRows = rowsByPair.get(key) ?? [];
    pairRows.push(row);
    rowsByPair.set(key, pairRows);
  }

  const logsByPair = new Map<string, CheckoutAttributionLog[]>();
  for (const group of loggedGroups) {
    const quantity = group._sum.quantity ?? 0;
    if (quantity === 0 || !group.bookingId) continue;
    const key = pairKey(group.bookingId, group.assetId);
    const logs = logsByPair.get(key) ?? [];
    logs.push({ bookingAssetId: group.bookingAssetId ?? null, quantity });
    logsByPair.set(key, logs);
  }

  const loggedByRow = new Map<Row, number>();
  for (const [key, pairRows] of rowsByPair) {
    // Each row keeps its own id as its key: the fill order among slices is
    // defined on it (`compareSlicesForGreedyFill`), and it is how a log finds
    // the row it names. A row read without an id gets a key no log can name.
    const keyOf = (row: Row, position: number) => row.id ?? `#${position}`;
    const attributed = attributeDispositionsByBookingAsset({
      bookingAssetRows: pairRows.map((row, position) => ({
        id: keyOf(row, position),
        assetKitId: row.assetKitId ?? null,
        quantity: resolveSentUnits({
          quantity: row.quantity,
          checkedOutAt: row.checkedOutAt ?? null,
          checkedOutQuantity: row.checkedOutQuantity ?? null,
        }),
      })),
      consumptionLogs: logsByPair.get(key) ?? [],
    });
    pairRows.forEach((row, position) => {
      loggedByRow.set(row, attributed.get(keyOf(row, position)) ?? 0);
    });
  }
  return loggedByRow;
}

/**
 * The reads {@link getPeakReservedUnitsByAsset} issues.
 *
 * Structural, and declared here rather than taken from the shared
 * availability client: this read needs every column of its rows (`id`,
 * `assetKitId` and `checkedOutQuantity` are optional on the shared client),
 * so a caller that cannot supply them fails to compile.
 */
export type PeakReservedTxClient = ConvertedSliceRowsClient & {
  bookingAsset: {
    findMany: (args: {
      where: Prisma.BookingAssetWhereInput;
      select: {
        id: true;
        assetId: true;
        bookingId: true;
        quantity: true;
        assetKitId: true;
        sourceAllocation: true;
        checkedOutAt: true;
        checkedOutQuantity: true;
        booking: { select: { from: true; to: true; status: true } };
      };
    }) => Promise<
      Array<{
        id: string;
        assetId: string;
        bookingId: string;
        quantity: number;
        assetKitId: string | null;
        sourceAllocation?: BookingSourceAllocation;
        checkedOutAt?: Date | null;
        checkedOutQuantity: number | null;
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
 * The method is picked per (booking, asset) group, and every group's
 * intervals are combined before one sweep per asset, so an asset with LEGACY
 * groups on some bookings and converted groups on others never sums separate
 * peaks:
 *
 * - A converted group (any slice not LEGACY) reads its AUTO / MANUAL slices'
 *   source rows: each slice holds `sum(quantity - releasedQuantity)` over its
 *   rows, UNASSIGNED included. Its KIT slices contribute nothing, and its
 *   disposition logs are not read (shares already moved them to released).
 * - A LEGACY group reduces each standalone slice by already-logged
 *   {@link RESERVATION_REDUCING_CATEGORIES} dispositions. They are attributed
 *   per `BookingAsset` ROW: one (booking, asset) pair can hold a standalone
 *   slice and kit-driven ones at once, so a return logged against a kit slice
 *   must not shrink the standalone reservation this guard is protecting. The
 *   attribution is {@link loggedUnitsByReservationRow}, shared with every
 *   availability read, so this read agrees with the units they show as out.
 *   A LEGACY row never counts for less
 *   than the units it has out right now, so a slice returned in full and
 *   checked out again keeps its second trip in the peak (see
 *   {@link reservedUnitsStillHeld}).
 *
 * Queries: the slices, then (in parallel) the LEGACY groups' logs and the
 * converted slices' source rows, each only when such groups exist.
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
  // never summed into the peak (every caller counts them through
  // `AssetKit.quantity`), but they are needed to place untagged dispositions:
  // what the standalone slice cannot have given back belongs to them.
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
      sourceAllocation: true,
      checkedOutAt: true,
      checkedOutQuantity: true,
      booking: { select: { from: true, to: true, status: true } },
    },
  });

  if (rows.length === 0) return peaks;

  const pairOf = (r: { bookingId: string; assetId: string }) =>
    `${r.bookingId}:${r.assetId}`;
  const convertedPairs = new Set(
    rows.filter((r) => isConvertedSlice(r.sourceAllocation)).map(pairOf)
  );
  const legacyRows = rows.filter((r) => !convertedPairs.has(pairOf(r)));
  const convertedSliceIds = rows
    .filter(
      (r) =>
        convertedPairs.has(pairOf(r)) &&
        r.assetKitId === null &&
        r.sourceAllocation !== undefined &&
        CONVERTED_STANDALONE_MODES.has(r.sourceAllocation)
    )
    .map((r) => r.id);

  const [loggedGroups, remainingBySlice] = await Promise.all([
    legacyRows.length === 0
      ? Promise.resolve([])
      : tx.consumptionLog.groupBy({
          by: ["bookingAssetId", "bookingId", "assetId"],
          where: {
            assetId: { in: assetIds },
            bookingId: { in: [...new Set(legacyRows.map((r) => r.bookingId))] },
            category: { in: [...RESERVATION_REDUCING_CATEGORIES] },
          },
          _sum: { quantity: true },
        }),
    loadRemainingReservationBySlice(tx, organizationId, convertedSliceIds),
  ]);

  // Only LEGACY groups place dispositions: converted groups read their source
  // rows instead. The logs read is scoped to the bookings holding a LEGACY
  // row, so a booking that also holds a converted pair brings that pair's logs
  // too; only LEGACY rows reach the attribution, so those logs are ignored.
  // Every row of a LEGACY pair is passed, kit-driven ones included, so
  // untagged logs can reach them.
  const loggedByRow = loggedUnitsByReservationRow(legacyRows, loggedGroups);

  const intervalsByAsset = new Map<string, AvailabilityInterval[]>();
  for (const row of rows) {
    // Kit-driven slices are counted through `AssetKit.quantity`; summing them
    // here too would subtract the same units twice. In a converted group
    // these are the KIT slices.
    if (row.assetKitId !== null) continue;
    if (!row.booking) continue;

    const remaining = convertedPairs.has(pairOf(row))
      ? remainingBySlice.get(row.id) ?? 0
      : reservedUnitsStillHeld(row, loggedByRow.get(row) ?? 0);
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

/**
 * Minimal Prisma surface {@link assertAssetQuantityNotBelowReservations}
 * needs: the `custody` and `assetKit` delegates of
 * {@link AvailabilityBatchClient} for the two holders it sums itself, plus the
 * reads {@link getPeakReservedUnitsByAsset} issues for the booking term
 * (source rows for converted groups included).
 */
export type AssertAssetQuantityNotBelowReservationsTxClient = Pick<
  AvailabilityBatchClient,
  "custody" | "assetKit"
> &
  PeakReservedTxClient;

/**
 * STOCK-LOWERING guard: blocks reducing a QUANTITY_TRACKED asset's total
 * `quantity` below what is ALREADY committed elsewhere: operator custody,
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
 * demand from {@link getPeakReservedUnitsByAsset}: every ACTIVE (RESERVED /
 * ONGOING / OVERDUE) STANDALONE (`assetKitId: null`) reservation for this
 * asset, across its whole future timeline. Two bookings that never overlap do
 * not stack (a naive sum would reject a perfectly safe reduction), returns are
 * netted per slice, and a slice never counts for less than the units it has
 * out right now. The method is picked per (booking, asset) group: a converted
 * group's AUTO / MANUAL slices hold the remaining reservation of their source
 * rows (`quantity - releasedQuantity`, UNASSIGNED included) instead of the
 * booked amount net of logs.
 *
 * A reduction to EXACTLY `committed` is allowed. Only `newTotal < committed`
 * rejects, since the pool is fully (not over-) subscribed at that total.
 *
 * Runs a FIXED small number of queries (custody, kits and reserved rows in
 * parallel, then logged dispositions for LEGACY groups and source rows for
 * converted ones, in parallel and each only when needed) regardless of how many bookings, kits or
 * custody rows exist for the asset.
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
  const [custodyGroups, inKitsGroups, peakReservedByAsset] = await Promise.all([
    tx.custody.groupBy({
      by: ["assetId"],
      // Custody has no `organizationId` column of its own, so it is scoped
      // through the asset relation, mirroring `getAssetAvailabilityBatch`'s
      // identical org-scope guard (org-scope-user-supplied-ids rule).
      // `kitCustodyId: null` = OPERATOR custody only. Kit-inherited custody is
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
    // The booking term is the same peak the kit picker reads, so the guard
    // and the picker can never disagree about what bookings hold. It nets
    // returns per slice: a return logged against a kit slice of the same
    // booking must not shrink the standalone reservation.
    getPeakReservedUnitsByAsset({ assetIds: [assetId], organizationId, tx }),
  ]);

  const inCustody = custodyGroups[0]?._sum.quantity ?? 0;
  const inKits = inKitsGroups[0]?._sum.quantity ?? 0;
  const peakReserved = peakReservedByAsset.get(assetId) ?? 0;

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

/**
 * The reads {@link computeCustodyAvailability} issues. Structural rather than a
 * Prisma type so an interactive transaction client and the global `db` both
 * satisfy it without a cast.
 */
export type CustodyAvailabilityClient = {
  custody: {
    aggregate: (args: {
      where: {
        assetId: string;
        kitCustodyId: null;
        asset: { organizationId: string };
      };
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
  assetKit: {
    aggregate: (args: {
      where: { assetId: string; organizationId: string };
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
  bookingAsset: {
    aggregate: (args: {
      where: {
        assetId: string;
        assetKitId: null;
        booking: { status: { in: BookingStatus[] } };
      };
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
};

/** What {@link computeCustodyAvailability} resolves an asset's pool into. */
export type CustodyAvailability = {
  /** Units a custodian already holds directly. */
  inCustody: number;
  /** Units allocated to kits. */
  inKits: number;
  /** Units out on an ONGOING or OVERDUE booking, kit-driven rows excluded. */
  checkedOut: number;
  /** `total − inCustody − inKits − checkedOut`. */
  available: number;
};

/**
 * How many units of a quantity-tracked asset may be handed to a custodian
 * right now.
 *
 * `available = total − in custody − allocated to kits − out on an active
 * booking`, which is the same shape as `getAssetAvailabilityBatch`'s
 * `physicalAvailable`. The two must agree: an operator who is told a booking
 * can take 45 units should not be offered 71 for custody one screen away.
 *
 * Each term is scoped so the axes do not overlap, and none of these filters is
 * optional:
 *
 * - custody counts OPERATOR rows only (`kitCustodyId: null`). A kit in custody
 *   cascades a `Custody` row onto every member, and those units are already in
 *   `inKits`, so counting both deducts them twice and understates the pool.
 * - checked-out counts non-kit-driven `BookingAsset` rows only
 *   (`assetKitId: null`), for the same reason.
 * - both are org-scoped, because this is a reusable export and the asset id may
 *   come from request input.
 *
 * RESERVED bookings are deliberately NOT subtracted: those units are still
 * physically on the shelf until their booking is checked out, so they are valid
 * targets for custody today. That booking re-validates availability at its own
 * check-out.
 *
 * Lives in this leaf rather than beside `getAssetAvailabilityBatch` so
 * `asset/service.server` can read it without dragging in the
 * `availability.server` to `booking/service.server` graph. See this file's
 * header. That is also why it aggregates directly instead of delegating to the
 * batch primitive.
 *
 * Shared so the number the scanner's quantity input is capped by and the number
 * the write enforces are the same number rather than two derivations of it. A
 * cap that disagrees with the write refuses assignments the server would have
 * accepted, or offers ones it then rejects.
 *
 * @param client - Transaction client, or `db` for a read-only caller
 * @param args.assetId - The quantity-tracked asset
 * @param args.organizationId - Workspace the asset belongs to
 * @param args.totalQuantity - Its `Asset.quantity` (workspace stock)
 * @returns The parts and the total, so a caller can name them in an error
 */
export async function computeCustodyAvailability(
  client: CustodyAvailabilityClient,
  {
    assetId,
    organizationId,
    totalQuantity,
  }: { assetId: string; organizationId: string; totalQuantity: number }
): Promise<CustodyAvailability> {
  const [custodySum, kitSum, bookingCheckedOutSum] = await Promise.all([
    client.custody.aggregate({
      where: { assetId, kitCustodyId: null, asset: { organizationId } },
      _sum: { quantity: true },
    }),
    client.assetKit.aggregate({
      where: { assetId, organizationId },
      _sum: { quantity: true },
    }),
    client.bookingAsset.aggregate({
      where: {
        assetId,
        assetKitId: null,
        booking: {
          status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        },
      },
      _sum: { quantity: true },
    }),
  ]);

  const inCustody = custodySum._sum.quantity ?? 0;
  const inKits = kitSum._sum.quantity ?? 0;
  const checkedOut = bookingCheckedOutSum._sum.quantity ?? 0;

  return {
    inCustody,
    inKits,
    checkedOut,
    available: totalQuantity - inCustody - inKits - checkedOut,
  };
}
