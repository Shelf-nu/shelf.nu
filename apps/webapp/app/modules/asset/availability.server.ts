/**
 * Asset Availability Primitive
 *
 * Single source of truth for "how many units of a QUANTITY_TRACKED asset are
 * available", windowed by booking date-overlap. Replaces the six divergent
 * inline availability formulas that previously lived across the asset
 * overview, booking pickers, and quantity-adjustment routes — each of which
 * computed a slightly different (and sometimes wrong) number.
 *
 * Exports, in dependency order:
 *   - {@link peakConcurrent} — pure interval-sweep primitive (no I/O).
 *   - {@link overCommittedWindows} — sibling pure sweep that returns the
 *     actual time RANGES where concurrent demand exceeds a total, instead of
 *     just the peak number. Powers the bookings-list "Stock conflict" pill
 *     (`~/modules/booking/stock-conflicts.server`).
 *   - {@link getAssetAvailability} — the windowed availability read (I/O).
 *   - {@link getAssetAvailabilityBatch} — the same read for MANY assets in a
 *     fixed small number of queries (no N+1 fan-out).
 *   - {@link buildInsufficientStockMessage} — standardized shortfall copy.
 *   - {@link assertAssetQuantityAvailable} — directional write guard, single asset.
 *   - {@link assertAssetQuantitiesAvailable} — plural sibling: validates MANY
 *     assets in ONE batched read, aggregating every shortfall into one error.
 *   - {@link assertAssetQuantityNotBelowReservations} — STOCK-LOWERING guard:
 *     blocks reducing `Asset.quantity` itself below what's already committed
 *     to custody, kits, or active bookings (the inverse direction from the
 *     two guards above, which police booking-side reservation increases).
 *
 * ## Windowed-occupancy model (ONGOING/OVERDUE, not "checked-out forever")
 *
 * A checked-out unit is NOT gone forever — it is expected back by its
 * booking's `to` date. So ONGOING bookings are treated exactly like RESERVED
 * ones: their real `[from, to]` window competes for the pool only while that
 * window is relevant. A booking that already ended before the TARGET window
 * even starts (e.g. an ONGOING booking returning Jul29, checked against a
 * booking starting Jul30) must NOT reduce that target window's availability —
 * see {@link resolveIntervalTo} and the reserved-rows query's `booking.OR`.
 *
 * OVERDUE is the one exception: an overdue-not-yet-returned booking has
 * blown past its `to` with no logged return, so there is no known date it
 * stops competing for the pool. OVERDUE rows are (a) fetched regardless of
 * the target window (they might return at any moment, so they must be
 * considered for every window, not just ones that literally overlap their
 * stale `to`) and (b) given a sentinel `to` far in the future so the
 * peak-concurrent sweep treats them as occupying every current/future window
 * until an explicit check-in changes their status.
 *
 * `checkedOut` (physically-off-the-shelf-right-now) is kept ONLY for the
 * physical-now headline ({@link AssetAvailability.physicalAvailable}) — it is
 * deliberately NOT subtracted a second time in `bookable`, because ONGOING/
 * OVERDUE occupancy is already fully captured via `reserved`'s windowed sweep
 * above. Subtracting both was the original modeling bug: every ONGOING/
 * OVERDUE unit was treated as permanently unavailable to EVERY window,
 * including windows that start after the booking's own return date.
 *
 * `bookable` is intentionally **signed** (can be negative) — callers that
 * display it must clamp for presentation; the primitive itself never clamps,
 * so write guards can distinguish "already over-committed" from "exactly at
 * capacity" (see {@link assertAssetQuantityAvailable}'s directional rule,
 * the #2725 recovery fix).
 *
 * @see superpowers/2026-07-27-qt-availability-unification-plan.md
 */

import type { Prisma } from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";
import {
  checkQuantityAvailable,
  computeAvailability,
  overCommittedWindows as overCommittedWindowsCore,
} from "@shelf/quantity-control";
import { db } from "~/database/db.server";
import { computeCheckedOutBreakdownForAsset } from "~/modules/booking/checked-out.server";
import type { CheckoutSession } from "~/modules/booking/checkout-attribution";
import {
  attributeDispositionsByBookingAsset,
  checkoutSessionsToLogsByAsset,
} from "~/modules/booking/checkout-attribution";
import {
  computeAvailableQuantity,
  type AvailableQuantityClient,
} from "~/modules/consumption-log/service.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import {
  ACTIVE_BOOKING_STATUSES,
  assertAssetQuantityNotBelowReservations,
  buildActiveBookingWhere,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
} from "./availability-primitives.server";
import type {
  AssertAssetQuantityNotBelowReservationsTxClient,
  AvailabilityInterval,
} from "./availability-primitives.server";

const label: ErrorLabel = "Assets";

// These symbols physically live in the dependency-free
// `./availability-primitives.server` leaf (see that file's header for the
// import-cycle rationale). Re-exported here so this module remains the single
// public entrypoint every consumer imports the QT-availability domain from.
export {
  ACTIVE_BOOKING_STATUSES,
  assertAssetQuantityNotBelowReservations,
  buildActiveBookingWhere,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
};
export type {
  AssertAssetQuantityNotBelowReservationsTxClient,
  AvailabilityInterval,
};

/**
 * Sibling sweep to {@link peakConcurrent}: instead of collapsing the whole
 * timeline down to a single peak number, returns every time RANGE where the
 * running concurrent quantity is STRICTLY GREATER than `total` (i.e. a
 * genuine over-commitment, not merely "at capacity"). Empty when the running
 * sum never exceeds `total`.
 *
 * The event-sweep itself is owned by `@shelf/quantity-control` — the same
 * O(n log n) walk as {@link peakConcurrent} (same events, same
 * releases-before-claims tie-break, same timestamp-grouped batching, same
 * adjacent-window merging). The package's primitive additionally tags each
 * window with the `peak` level reached inside it; this module's public
 * contract has always been `{from, to}` only (and its callers/tests depend on
 * exactly that shape), so the extra `peak` field is projected away here. The
 * `from`/`to` boundaries are byte-identical to the package's.
 *
 * @param intervals - committed booking intervals (already filtered to the assets/pool in question)
 * @param total - the asset's total quantity; the threshold intervals must NOT exceed
 * @returns the `[from, to)` ranges where concurrent demand exceeded `total` (empty for none)
 */
export function overCommittedWindows(
  intervals: AvailabilityInterval[],
  total: number
): Array<{ from: Date; to: Date }> {
  return overCommittedWindowsCore(intervals, total).map(({ from, to }) => ({
    from,
    to,
  }));
}

/* -------------------------------------------------------------------------- */
/*                            getAssetAvailability                            */
/* -------------------------------------------------------------------------- */

/**
 * Minimal Prisma surface {@link getAssetAvailability} needs. Both the
 * extended top-level client and an interactive transaction client satisfy
 * this structurally, so callers can pass either without type gymnastics
 * (same approach as `OrgValidationTxClient` / `RecordEventTxClient` — see
 * `~/utils/org-validation.server` and `~/modules/activity-event/service.server`).
 */
export type PrismaClientOrTx = {
  assetKit: {
    aggregate: (args: {
      where: Prisma.AssetKitWhereInput;
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: number | null } }>;
  };
  bookingAsset: {
    findMany: (args: {
      where: Prisma.BookingAssetWhereInput;
      select: {
        bookingId: true;
        quantity: true;
        booking: { select: { from: true; to: true; status: true } };
      };
    }) => Promise<
      Array<{
        bookingId: string;
        quantity: number;
        booking: { from: Date; to: Date; status: BookingStatus } | null;
      }>
    >;
  };
  consumptionLog: {
    groupBy: (args: {
      by: ["bookingId"];
      where: Prisma.ConsumptionLogWhereInput;
      _sum: { quantity: true };
    }) => Promise<
      Array<{ bookingId: string | null; _sum: { quantity: number | null } }>
    >;
  };
};

/**
 * A date range to window reservation queries by. `null` (or omitted) means
 * "no window" — reservations are summed informationally rather than peaked.
 */
export type AssetAvailabilityWindow = { from: Date; to: Date } | null;

/** The full availability breakdown for a single QUANTITY_TRACKED asset. */
export type AssetAvailability = {
  /** `Asset.quantity` — total units owned. */
  total: number;
  /** Units currently held by operator custody (`kitCustodyId IS NULL`). */
  inCustody: number;
  /** Σ `AssetKit.quantity` — units currently allocated into kits. */
  inKits: number;
  /**
   * Units physically checked out RIGHT NOW on ONGOING/OVERDUE bookings,
   * window-independent — the physical-now headline figure. Used for
   * {@link physicalAvailable} only; deliberately NOT subtracted again in
   * {@link bookable} (see the module doc's "windowed-occupancy model" note —
   * that double-subtraction was the original modeling bug).
   */
  checkedOut: number;
  /**
   * Standalone (non-kit-driven) reserved units competing for this pool.
   * With a `window`, this is the peak-concurrent quantity across
   * overlapping RESERVED/ONGOING reservations plus any OVERDUE reservation
   * (sentinel-extended — see {@link resolveIntervalTo}), computed by
   * {@link peakConcurrent}. A booking that already ended before the window
   * starts does NOT contribute. Without a window, it's the CONSERVATIVE Σ of
   * every active commitment's remaining (checked-out units included), so a
   * dateless `bookable` never over-promises.
   */
  reserved: number;
  /**
   * Window-agnostic Σ of remaining quantity across UPCOMING (RESERVED-status)
   * bookings only. ONGOING/OVERDUE units are physically out (or in progress)
   * and are reported via `checkedOut` / "Checked out (bookings)", so they are
   * deliberately excluded here — otherwise a checked-out booking would both
   * inflate this "committed, still on the shelf" figure AND be miscounted as
   * an "upcoming booking" in the tooltip.
   */
  reservedTotal: number;
  /** Count of distinct UPCOMING (RESERVED) bookings contributing to `reservedTotal`. */
  reservingBookingCount: number;
  /** `total − inCustody − inKits − checkedOut` — physical-now headline. */
  physicalAvailable: number;
  /**
   * `total − inCustody − inKits − reserved`. **Signed** — never clamped
   * here. A negative value means the pool is already over-committed;
   * callers clamp to 0 only when displaying the number, never before using
   * it in a write guard (see {@link assertAssetQuantityAvailable}). Does
   * NOT separately subtract `checkedOut` — ONGOING/OVERDUE occupancy is
   * already fully captured in `reserved`'s windowed sweep (see the module
   * doc).
   */
  bookable: number;
};

/** Arguments for {@link getAssetAvailability}. */
type GetAssetAvailabilityArgs = {
  /** The asset to compute availability for. */
  assetId: string;
  /** Caller's organization — scopes every reservation/kit query. */
  organizationId: string;
  /** Optional booking window to peak-concurrent the reserved quantity over. */
  window?: AssetAvailabilityWindow;
  /** Exclude this booking's own reservation from the computed sums. */
  excludeBookingId?: string;
  /** Prisma client or active transaction; defaults to the global `db`. */
  db?: PrismaClientOrTx;
};

/**
 * Computes the full windowed availability breakdown for a QUANTITY_TRACKED
 * asset. This is the single primitive every read surface and write guard in
 * the QT-availability system consumes — see the module doc for the full
 * windowed-occupancy rationale.
 *
 * Formula:
 * ```
 * physicalAvailable = total − inCustody − inKits − checkedOut
 * bookable           = total − inCustody − inKits − reserved
 * reservedTotal      = Σ(remaining across RESERVED-status bookings only)
 * ```
 *
 * `checkedOut` feeds ONLY `physicalAvailable` (the physical-now headline) —
 * it is NOT subtracted again in `bookable`. `reserved` is windowed: with a
 * `window`, RESERVED/ONGOING reservations are peak-concurrent swept over
 * their real `[from, to]` (see {@link peakConcurrent}) so a booking that
 * already ended before the window starts doesn't reduce it; OVERDUE
 * reservations are swept with a sentinel `to` (see {@link resolveIntervalTo})
 * so an unreturned unit keeps occupying every current/future window. Without
 * a `window`, `reserved` is the conservative Σ of every active commitment
 * (checked-out included) so a dateless `bookable` never over-promises.
 * `reservedTotal`/`reservingBookingCount` are the informational
 * "Reserved (bookings)" figure — UPCOMING (RESERVED) bookings only, disjoint
 * from `checkedOut`.
 *
 * Reserved rows are restricted to standalone reservations
 * (`assetKitId IS NULL`) — kit-driven slices are already accounted for via
 * `inKits` and must never be summed twice. Per-booking remaining quantity
 * subtracts already-logged RETURN/CONSUME/LOSS/DAMAGE dispositions exactly as
 * `computeBookingAvailableQuantity` does (partial check-in writes
 * `ConsumptionLog` rows without decrementing `BookingAsset.quantity`), and is
 * clamped at 0 per row as defence-in-depth.
 *
 * @param args.assetId - The asset to compute availability for.
 * @param args.organizationId - Caller's organization (scopes every query).
 * @param args.window - Optional booking window to peak the reserved quantity over.
 * @param args.excludeBookingId - Exclude this booking's own reservation from the sums.
 * @param args.db - Prisma client or active transaction; defaults to the global `db`.
 * @returns The full {@link AssetAvailability} breakdown.
 * @throws {ShelfError} If the underlying queries fail.
 */
export async function getAssetAvailability({
  assetId,
  organizationId,
  window = null,
  excludeBookingId,
  db: dbOrTx,
}: GetAssetAvailabilityArgs): Promise<AssetAvailability> {
  // Cast through `unknown`: the real extended Prisma client's delegate
  // methods are deeply generic (return type inferred from `select`), while
  // `PrismaClientOrTx` is a plain structural type for this module's exact
  // queries only. Calling through a `PrismaClientOrTx | ExtendedPrismaClient`
  // union (no cast) breaks TS's overload/select-based inference — same
  // rationale as `computeCheckedOutForAsset`'s `tx: any` parameter below.
  const client = (dbOrTx ?? db) as unknown as PrismaClientOrTx;
  try {
    const [{ total, inCustody }, inKitsAgg, checkedOutBreakdown] =
      await Promise.all([
        // Pass the active client so `total`/`inCustody` read from the SAME
        // transaction as the rest of this availability computation (matters when
        // a write guard calls this inside a row-locked tx — see the param doc).
        // `client` is the real db/tx behind the module's minimal `PrismaClientOrTx`
        // structural type, so it genuinely carries the `asset`/`custody` delegates
        // `AvailableQuantityClient` needs — same `as unknown as` bridge this
        // module already uses for its clients (see the cast above).
        computeAvailableQuantity(
          assetId,
          client as unknown as AvailableQuantityClient
        ),
        client.assetKit.aggregate({
          where: { assetId, organizationId },
          _sum: { quantity: true },
        }),
        computeCheckedOutBreakdownForAsset(client, assetId, organizationId),
      ]);
    const inKits = inKitsAgg._sum.quantity ?? 0;
    // #2790 ③: `physicalAvailable` must subtract only the STANDALONE
    // checked-out units — kit-driven checkout is already covered by `inKits`,
    // so subtracting the full checked-out here (as before) double-counts
    // kit-driven units and can drive the headline negative. The DISPLAYED
    // `checkedOut` field below keeps the FULL count so that number is unchanged.
    const checkedOut = checkedOutBreakdown.total;
    const standaloneCheckedOut = checkedOutBreakdown.standalone;

    /** Where clause for the standalone (non-kit-driven) reservations. */
    const bookingAssetWhere: Prisma.BookingAssetWhereInput = {
      assetId,
      // Kit-driven slices are already counted via `inKits` — summing them
      // here too would double-count the same units.
      assetKitId: null,
      booking: buildActiveBookingWhere(organizationId, window),
    };
    if (excludeBookingId) {
      bookingAssetWhere.bookingId = { not: excludeBookingId };
    }

    const reservedRows = await client.bookingAsset.findMany({
      where: bookingAssetWhere,
      select: {
        bookingId: true,
        quantity: true,
        booking: { select: { from: true, to: true, status: true } },
      },
    });

    let reservedTotal = 0;
    let allActiveRemaining = 0;
    const reservingBookingIds = new Set<string>();
    const intervals: AvailabilityInterval[] = [];

    if (reservedRows.length > 0) {
      const bookingIds = reservedRows.map((r) => r.bookingId);

      /**
       * Sum already-logged disposition quantities per booking for this
       * asset — mirrors `computeBookingAvailableQuantity`'s reserved-row
       * math exactly (RETURN/CONSUME/LOSS/DAMAGE reduce the reservation
       * footprint; CHECKOUT does not, it's a custody handoff, not a
       * reduction).
       */
      const loggedGroups = await client.consumptionLog.groupBy({
        by: ["bookingId"],
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

      for (const row of reservedRows) {
        const logged = loggedByBookingId.get(row.bookingId) ?? 0;
        // Clamp at 0 per row so an over-logged booking (should not happen,
        // but defence-in-depth) can't push `reserved` negative.
        const remaining = Math.max(0, row.quantity - logged);
        if (remaining === 0) continue;

        // Every active booking occupies its window for the peak-concurrency
        // sweep (and the windowless conservative `reserved` below).
        allActiveRemaining += remaining;

        // "Reserved (bookings)" is informational and means UPCOMING
        // commitments — RESERVED-status bookings only. ONGOING/OVERDUE units
        // are physically out (or in progress) and surface via `checkedOut` /
        // "Checked out (bookings)"; counting them here would double-report and
        // inflate the booking count (e.g. show "2 upcoming bookings" when one
        // is already checked out).
        if (row.booking?.status === BookingStatus.RESERVED) {
          reservedTotal += remaining;
          reservingBookingIds.add(row.bookingId);
        }

        if (window) {
          // A row with no window on its own booking can't be placed on the
          // timeline — treat it as spanning (and therefore always
          // concurrent within) the query window, the conservative reading.
          const from = row.booking?.from ?? window.from;
          const to = resolveIntervalTo(
            row.booking?.status,
            row.booking?.to,
            window.to
          );
          intervals.push({ from, to, qty: remaining });
        }
      }
    }

    // `reservedTotal` counts only RESERVED (upcoming) bookings, which have no
    // checked-out units, so it's inherently disjoint from `checkedOut` — no
    // netting needed.
    //
    // Windowless `reserved` (drives `bookable` when no dates are in scope, e.g.
    // add-to-existing) stays CONSERVATIVE: subtract every active commitment,
    // including checked-out ONGOING/OVERDUE units.
    const reserved = window ? peakConcurrent(intervals) : allActiveRemaining;
    // Signed headline figures come from the pure package formula:
    //   physicalAvailable = total − inCustody − inKits − checkedOut
    //   bookable          = total − inCustody − inKits − reservedPeak
    // `bookable` deliberately subtracts `reserved` (mapped to `reservedPeak`),
    // NOT `checkedOut` a second time — ONGOING/OVERDUE occupancy is already
    // captured in `reserved`'s windowed sweep (see the module doc).
    //
    // #2790 ③: feed the STANDALONE checked-out into `computeAvailability` so
    // `physicalAvailable` subtracts only free-pool units off the shelf — the
    // kit-driven ones are already subtracted via `inKits`. The full
    // `checkedOut` is restored on the returned struct below (display value).
    const { physicalAvailable, bookable } = computeAvailability({
      total,
      inCustody,
      inKits,
      reservedPeak: reserved,
      checkedOut: standaloneCheckedOut,
    });

    return {
      total,
      inCustody,
      inKits,
      checkedOut,
      reserved,
      reservedTotal,
      reservingBookingCount: reservingBookingIds.size,
      physicalAvailable,
      bookable,
    };
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while computing asset availability. Please try again or contact support.",
      additionalData: { assetId, organizationId, excludeBookingId },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                         getAssetAvailabilityBatch                          */
/* -------------------------------------------------------------------------- */

/**
 * Minimal Prisma surface {@link getAssetAvailabilityBatch} needs. Deliberately
 * a SEPARATE type from {@link PrismaClientOrTx} (the singular primitive's
 * surface) rather than an extension of it: every query here is shaped
 * `assetId: { in: [...] }` + `groupBy`/`findMany` across many assets, while
 * the singular type's methods are shaped for a single `assetId` — sharing one
 * type would force one of the two primitives into an unnatural cast.
 */
export type AvailabilityBatchClient = {
  asset: {
    findMany: (args: {
      where: Prisma.AssetWhereInput;
      select: { id: true; quantity: true };
    }) => Promise<Array<{ id: string; quantity: number | null }>>;
  };
  custody: {
    groupBy: (args: {
      by: ["assetId"];
      where: Prisma.CustodyWhereInput;
      _sum: { quantity: true };
    }) => Promise<
      Array<{ assetId: string; _sum: { quantity: number | null } }>
    >;
  };
  assetKit: {
    groupBy: (args: {
      by: ["assetId"];
      where: Prisma.AssetKitWhereInput;
      _sum: { quantity: true };
    }) => Promise<
      Array<{ assetId: string; _sum: { quantity: number | null } }>
    >;
  };
  /**
   * Used for BOTH the checked-out pivots read and the standalone-reserved
   * rows read (same select shape for both — the checked-out read simply
   * ignores the `booking.from`/`booking.to`/`booking.status` fields it
   * doesn't need). Reusing one signature for both call sites keeps this type
   * from needing method overloads.
   *
   * `id`/`assetKitId` are OPTIONAL: only the checked-out pivots read selects
   * them (it needs `id` to attribute checkout claims per slice and `assetKitId`
   * to split standalone vs kit-driven checked-out — #2790 ③). The reserved-rows
   * read leaves them off, so the widened type still accepts its narrower select.
   */
  bookingAsset: {
    findMany: (args: {
      where: Prisma.BookingAssetWhereInput;
      select: {
        id?: true;
        assetId: true;
        bookingId: true;
        quantity: true;
        assetKitId?: true;
        booking: { select: { from: true; to: true; status: true } };
        // Optional like `id`/`assetKitId`: only the checked-out read needs the
        // live asset status (to gate the legacy all-at-once branch per asset);
        // the reserved-rows read leaves it off.
        asset?: { select: { status: true } };
      };
    }) => Promise<
      Array<{
        id?: string;
        assetId: string;
        bookingId: string;
        quantity: number;
        assetKitId?: string | null;
        booking: { from: Date; to: Date; status: BookingStatus } | null;
        asset?: { status: AssetStatus } | null;
      }>
    >;
  };
  partialBookingCheckout: {
    findMany: (args: {
      where: Prisma.PartialBookingCheckoutWhereInput;
      select: {
        bookingId: true;
        assetIds: true;
        quantities: true;
        bookingAssetIds: true;
      };
    }) => Promise<
      Array<{
        bookingId: string;
        assetIds: string[];
        quantities: number[];
        bookingAssetIds: string[];
      }>
    >;
  };
  consumptionLog: {
    groupBy: (args: {
      by: ["bookingId", "assetId"];
      where: Prisma.ConsumptionLogWhereInput;
      _sum: { quantity: true };
    }) => Promise<
      Array<{
        bookingId: string | null;
        assetId: string;
        _sum: { quantity: number | null };
      }>
    >;
  };
};

/** Arguments shared by every asset in a {@link getAssetAvailabilityBatch} call. */
type GetAssetAvailabilityBatchCommonArgs = {
  /** Caller's organization — scopes every asset/reservation/kit/custody query. */
  organizationId: string;
  /** Booking window to peak-concurrent the reserved quantity over (`null` = unwindowed). */
  window: AssetAvailabilityWindow;
  /** Exclude this booking's own reservation from the computed `reserved` sums. */
  excludeBookingId?: string;
  /** Prisma client or active transaction; defaults to the global `db`. */
  db?: AvailabilityBatchClient;
};

/**
 * Batched sibling of {@link getAssetAvailability}: computes the same
 * `AssetAvailability` breakdown for MANY assets in a FIXED small number of
 * queries, regardless of how many assets are requested.
 *
 * The singular primitive fires ~4 round-trips per call (total+custody,
 * inKits, checkedOut, reserved [+ an optional logged-dispositions read]).
 * Calling it once per candidate asset — e.g. every QUANTITY_TRACKED asset
 * listed in the booking "manage assets" picker — would turn a loader with N
 * assets into `O(4·N)` reads, the exact fan-out this batch primitive exists
 * to avoid. Instead, every input is fetched ONCE with
 * `assetId: { in: assetIds } }` + `groupBy`/`findMany`, and each asset's
 * breakdown — including the {@link peakConcurrent} sweep — is derived in
 * memory afterward.
 *
 * Per-asset semantics are byte-for-byte identical to
 * {@link getAssetAvailability} — see that function's doc and the module doc's
 * "windowed-occupancy model" note for the full rationale:
 * - Reserved rows are restricted to standalone (`assetKitId: null`) slices —
 *   kit-driven slices are already counted via `inKits`, so summing them here
 *   too would double-count the same units (the bug this primitive exists to
 *   fix in the booking picker, which previously had no such filter).
 * - Logged RETURN/CONSUME/LOSS/DAMAGE dispositions reduce each booking's
 *   remaining reserved quantity before the peak-concurrent sweep, clamped at
 *   0 per (booking, asset) row.
 * - `checkedOut` is window-independent and feeds ONLY `physicalAvailable`;
 *   `bookable` subtracts `reserved` only — ONGOING bookings are windowed by
 *   their real `[from, to]`, OVERDUE bookings get a sentinel `to`
 *   ({@link resolveIntervalTo}) so they occupy every current/future window.
 *
 * `checkedOut` reimplements {@link computeCheckedOutForAsset}'s physically-out
 * math for all requested assets at once (see the `// why:` comment on
 * {@link computeCheckedOutBatch}) rather than calling that per-asset helper
 * in a loop, which is the same N+1 shape this whole primitive avoids.
 *
 * @param assetIds - Assets to compute availability for (deduped internally).
 * @param common - Shared arguments — see {@link GetAssetAvailabilityBatchCommonArgs}.
 * @returns Map keyed by every requested `assetId` → its {@link AssetAvailability}.
 * @throws {ShelfError} If the underlying queries fail.
 */
export async function getAssetAvailabilityBatch(
  assetIds: string[],
  {
    organizationId,
    window,
    excludeBookingId,
    db: dbOrTx,
  }: GetAssetAvailabilityBatchCommonArgs
): Promise<Map<string, AssetAvailability>> {
  const uniqueAssetIds = [...new Set(assetIds)];
  const result = new Map<string, AssetAvailability>();
  // Nothing requested → nothing to read. Early-return so callers can invoke
  // this unconditionally without paying for six pointless round-trips.
  if (uniqueAssetIds.length === 0) {
    return result;
  }

  const client = (dbOrTx ?? db) as unknown as AvailabilityBatchClient;

  try {
    const [assetRows, custodyGroups, inKitsGroups, checkedOutBreakdownByAsset] =
      await Promise.all([
        client.asset.findMany({
          where: { id: { in: uniqueAssetIds }, organizationId },
          select: { id: true, quantity: true },
        }),
        client.custody.groupBy({
          by: ["assetId"],
          // Custody has no `organizationId` column of its own — scope
          // through the asset relation so a custody row on another
          // workspace's asset (which should never happen for an id we
          // resolved ourselves, but this primitive is a reusable export
          // that any caller can hand arbitrary ids to) can never leak into
          // `inCustody`. Mirrors the org-scope-user-supplied-ids rule.
          // `kitCustodyId: null` = OPERATOR custody only — kit-inherited
          // custody rows are already counted via `AssetKit.quantity`
          // (`inKits`), so including them here would double-deduct.
          where: {
            assetId: { in: uniqueAssetIds },
            asset: { organizationId },
            kitCustodyId: null,
          },
          _sum: { quantity: true },
        }),
        client.assetKit.groupBy({
          by: ["assetId"],
          where: { assetId: { in: uniqueAssetIds }, organizationId },
          _sum: { quantity: true },
        }),
        computeCheckedOutBreakdownBatch(client, uniqueAssetIds, organizationId),
      ]);

    const totalByAsset = new Map(assetRows.map((a) => [a.id, a.quantity ?? 0]));
    const inCustodyByAsset = new Map(
      custodyGroups.map((c) => [c.assetId, c._sum.quantity ?? 0])
    );
    const inKitsByAsset = new Map(
      inKitsGroups.map((k) => [k.assetId, k._sum.quantity ?? 0])
    );

    const bookingAssetWhere: Prisma.BookingAssetWhereInput = {
      assetId: { in: uniqueAssetIds },
      // Kit-driven slices are already counted via `inKits` — summing them
      // here too would double-count the same units.
      assetKitId: null,
      booking: buildActiveBookingWhere(organizationId, window),
    };
    if (excludeBookingId) {
      bookingAssetWhere.bookingId = { not: excludeBookingId };
    }

    const reservedRows = await client.bookingAsset.findMany({
      where: bookingAssetWhere,
      select: {
        assetId: true,
        bookingId: true,
        quantity: true,
        booking: { select: { from: true, to: true, status: true } },
      },
    });

    const reservedTotalByAsset = new Map<string, number>();
    const allActiveRemainingByAsset = new Map<string, number>();
    const reservingBookingIdsByAsset = new Map<string, Set<string>>();
    const intervalsByAsset = new Map<string, AvailabilityInterval[]>();

    if (reservedRows.length > 0) {
      const reservedBookingIds = [
        ...new Set(reservedRows.map((r) => r.bookingId)),
      ];

      // Grouped by (bookingId, assetId) — unlike the singular primitive
      // (which groups by bookingId alone because it's already scoped to one
      // asset), this read spans many assets, so the key must disambiguate
      // both.
      const loggedGroups = await client.consumptionLog.groupBy({
        by: ["bookingId", "assetId"],
        where: {
          assetId: { in: uniqueAssetIds },
          bookingId: { in: reservedBookingIds },
          category: { in: [...RESERVATION_REDUCING_CATEGORIES] },
        },
        _sum: { quantity: true },
      });

      const loggedByKey = new Map<string, number>();
      for (const group of loggedGroups) {
        if (group.bookingId) {
          loggedByKey.set(
            `${group.bookingId}:${group.assetId}`,
            group._sum.quantity ?? 0
          );
        }
      }

      for (const row of reservedRows) {
        const logged = loggedByKey.get(`${row.bookingId}:${row.assetId}`) ?? 0;
        // Clamp at 0 per row so an over-logged booking can't push a single
        // asset's reserved total negative — mirrors the singular primitive.
        const remaining = Math.max(0, row.quantity - logged);
        if (remaining === 0) continue;

        // Every active booking occupies its window (peak-concurrency sweep +
        // windowless conservative `reserved`).
        allActiveRemainingByAsset.set(
          row.assetId,
          (allActiveRemainingByAsset.get(row.assetId) ?? 0) + remaining
        );

        // Informational "Reserved (bookings)" = UPCOMING (RESERVED) bookings
        // only — ONGOING/OVERDUE units surface via `checkedOut`. See the
        // singular primitive's matching comment.
        if (row.booking?.status === BookingStatus.RESERVED) {
          reservedTotalByAsset.set(
            row.assetId,
            (reservedTotalByAsset.get(row.assetId) ?? 0) + remaining
          );

          let reservingBookingIds = reservingBookingIdsByAsset.get(row.assetId);
          if (!reservingBookingIds) {
            reservingBookingIds = new Set();
            reservingBookingIdsByAsset.set(row.assetId, reservingBookingIds);
          }
          reservingBookingIds.add(row.bookingId);
        }

        if (window) {
          // A row with no window on its own booking can't be placed on the
          // timeline — treat it as spanning (and therefore always
          // concurrent within) the query window, the conservative reading.
          const from = row.booking?.from ?? window.from;
          const to = resolveIntervalTo(
            row.booking?.status,
            row.booking?.to,
            window.to
          );
          let intervals = intervalsByAsset.get(row.assetId);
          if (!intervals) {
            intervals = [];
            intervalsByAsset.set(row.assetId, intervals);
          }
          intervals.push({ from, to, qty: remaining });
        }
      }
    }

    for (const assetId of uniqueAssetIds) {
      const total = totalByAsset.get(assetId) ?? 0;
      const inCustody = inCustodyByAsset.get(assetId) ?? 0;
      const inKits = inKitsByAsset.get(assetId) ?? 0;
      const checkedOutBreakdown = checkedOutBreakdownByAsset.get(assetId) ?? {
        total: 0,
        standalone: 0,
      };
      // #2790 ③: DISPLAYED "Checked out" is the FULL count (kit + standalone);
      // `physicalAvailable` below subtracts only the STANDALONE portion so
      // kit-driven checked-out units aren't double-counted against `inKits`.
      const checkedOut = checkedOutBreakdown.total;
      // RESERVED-only, so already disjoint from `checkedOut` — no netting.
      const reservedTotal = reservedTotalByAsset.get(assetId) ?? 0;
      // Windowed uses the peak-concurrency sweep; windowless stays conservative
      // (all active commitments). Mirrors the singular primitive.
      const reserved = window
        ? peakConcurrent(intervalsByAsset.get(assetId) ?? [])
        : allActiveRemainingByAsset.get(assetId) ?? 0;
      // Same pure package formula as the singular primitive — `bookable`
      // subtracts `reserved` (as `reservedPeak`), never `checkedOut` twice.
      // `checkedOut` fed here is the STANDALONE portion (#2790 ③): the full
      // count is restored on the returned struct's `checkedOut` field below.
      const { physicalAvailable, bookable } = computeAvailability({
        total,
        inCustody,
        inKits,
        reservedPeak: reserved,
        checkedOut: checkedOutBreakdown.standalone,
      });

      result.set(assetId, {
        total,
        inCustody,
        inKits,
        checkedOut,
        reserved,
        reservedTotal,
        reservingBookingCount:
          reservingBookingIdsByAsset.get(assetId)?.size ?? 0,
        physicalAvailable,
        bookable,
      });
    }

    return result;
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while computing batched asset availability. Please try again or contact support.",
      additionalData: {
        assetIds: uniqueAssetIds,
        organizationId,
        excludeBookingId,
      },
      label,
    });
  }
}

/** Per-asset checked-out breakdown: full total + the standalone-only portion. */
type CheckedOutBreakdown = { total: number; standalone: number };

/**
 * Batched `checkedOut` breakdown — reimplements
 * {@link computeCheckedOutBreakdownForAsset}'s physically-out math for MANY
 * assets in TWO queries total, instead of calling that per-asset helper in a
 * loop (which would turn a picker with N assets into `O(2·N)` extra
 * round-trips — the exact fan-out {@link getAssetAvailabilityBatch} exists to
 * avoid).
 *
 * // why: there IS already a batched checkout-remaining helper
 * // (`computeBookingAssetsRemainingToCheckOut` in booking/service.server.ts),
 * // but it's batched over "many assets on ONE booking" — this call site
 * // needs the transposed shape, "many assets across POTENTIALLY MANY
 * // different active bookings", so it isn't directly reusable without
 * // calling it once per distinct booking (which is itself a form of
 * // per-something DB fan-out, just bounded by booking count instead of
 * // asset count). Re-deriving the formula directly against the raw tables
 * // keeps the query count fixed at 2 regardless of how many bookings or
 * // assets are involved, at the cost of duplicating the arithmetic — the
 * // trade-off called out in Task 8 of the QT-availability plan.
 *
 * Returns per asset BOTH figures (#2790 ③):
 *   - `total`     — every checked-out unit (kit + standalone); the DISPLAYED
 *                   "Checked out" number, byte-identical to the pre-split math.
 *   - `standalone`— only units checked out via standalone
 *                   (`assetKitId IS NULL`) slices; what `physicalAvailable`
 *                   subtracts so kit-driven checked-out units aren't
 *                   double-counted against `inKits`.
 *
 * Per (booking, asset), attribution mirrors
 * {@link computeCheckedOutBreakdownForAsset} exactly:
 *   - legacy all-at-once booking (zero {@link PartialBookingCheckout} sessions)
 *     ⇒ every slice's checked-out = its full `quantity`;
 *   - otherwise the booking's claims for the asset are attributed across its
 *     slices via {@link attributeDispositionsByBookingAsset} (standalone-first
 *     greedy) and each slice's checked-out = `min(slice.quantity, claimed)`.
 * Summing the per-slice checked-out reproduces the per-booking
 * `booked − remaining` the pre-split code computed, so `total` is unchanged.
 *
 * Booking statuses are pre-filtered to ONGOING/OVERDUE by the pivots query,
 * so — unlike the singular helper, which fetches `Booking.status` separately
 * to test the legacy-ONGOING fallback — every booking that shows up here
 * already satisfies that condition; the loop below never reads
 * `booking.status` (it's only selected because {@link AvailabilityBatchClient}
 * shares one `bookingAsset.findMany` select shape with the reserved-rows
 * read, which DOES need it — see that type's doc).
 *
 * @param client - Batch Prisma surface (see {@link AvailabilityBatchClient}).
 * @param assetIds - Assets to compute checked-out totals for (already deduped).
 * @param organizationId - Caller's organization — scopes the active-booking lookup.
 * @returns Map keyed by every requested `assetId` → its {@link CheckedOutBreakdown}.
 */
async function computeCheckedOutBreakdownBatch(
  client: AvailabilityBatchClient,
  assetIds: string[],
  organizationId: string
): Promise<Map<string, CheckedOutBreakdown>> {
  const breakdownByAsset = new Map<string, CheckedOutBreakdown>(
    assetIds.map((id) => [id, { total: 0, standalone: 0 }])
  );

  const pivots = await client.bookingAsset.findMany({
    where: {
      assetId: { in: assetIds },
      booking: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId,
      },
    },
    select: {
      // `id` + `assetKitId` are needed for per-slice attribution and the
      // standalone/kit-driven split (#2790 ③) — the reserved-rows read shares
      // this select type but leaves both off (they're optional there).
      id: true,
      assetId: true,
      bookingId: true,
      quantity: true,
      assetKitId: true,
      booking: { select: { from: true, to: true, status: true } },
      // Live asset status — the per-asset half of the legacy all-at-once
      // detection below. Must stay in step with the singular
      // `computeCheckedOutBreakdownForAsset`, which the parity test pins.
      asset: { select: { status: true } },
    },
  });

  if (pivots.length === 0) return breakdownByAsset;

  /**
   * Assets currently flagged off the shelf. The all-at-once checkout sets
   * CHECKED_OUT on every asset it processed, so this separates "was on the
   * booking when it was checked out" from "added afterwards" (which
   * `updateBookingAssets` leaves AVAILABLE on purpose). Only the former may
   * take the legacy branch below — see GitHub #2815.
   */
  const checkedOutAssetIds = new Set<string>();
  for (const p of pivots) {
    if (p.asset?.status === AssetStatus.CHECKED_OUT) {
      checkedOutAssetIds.add(p.assetId);
    }
  }

  /** slices grouped: bookingId → assetId → its slices on that booking. */
  type Slice = { id: string; quantity: number; assetKitId: string | null };
  const slicesByBookingByAsset = new Map<string, Map<string, Slice[]>>();
  for (const p of pivots) {
    let byAsset = slicesByBookingByAsset.get(p.bookingId);
    if (!byAsset) {
      byAsset = new Map();
      slicesByBookingByAsset.set(p.bookingId, byAsset);
    }
    const slice: Slice = {
      // `id` is always selected in production; the `??` fallback only covers
      // untyped test mocks that omit it (single-slice fixtures — a synthesized
      // key is unique enough there).
      id: p.id ?? `${p.bookingId}:${p.assetId}`,
      quantity: p.quantity ?? 0,
      assetKitId: p.assetKitId ?? null,
    };
    const list = byAsset.get(p.assetId);
    if (list) {
      list.push(slice);
    } else {
      byAsset.set(p.assetId, [slice]);
    }
  }

  const sessions = await client.partialBookingCheckout.findMany({
    where: { bookingId: { in: [...slicesByBookingByAsset.keys()] } },
    select: {
      bookingId: true,
      assetIds: true,
      quantities: true,
      bookingAssetIds: true,
    },
  });

  const sessionsByBooking = new Map<string, CheckoutSession[]>();
  for (const s of sessions) {
    let forBooking = sessionsByBooking.get(s.bookingId);
    if (!forBooking) {
      forBooking = [];
      sessionsByBooking.set(s.bookingId, forBooking);
    }
    forBooking.push(s);
  }

  for (const [bookingId, byAsset] of slicesByBookingByAsset) {
    const sessionsForBooking = sessionsByBooking.get(bookingId) ?? [];
    // A booking with zero sessions was checked out via the legacy
    // all-at-once flow (the partial flow always writes a session row) —
    // since these pivots are already scoped to ONGOING/OVERDUE, every
    // booked unit that was on the booking AT THAT POINT is physically off
    // the shelf. Which assets those are is decided per asset below; an
    // asset added later is still AVAILABLE and holds no units.
    const bookingIsLegacyAllAtOnce = sessionsForBooking.length === 0;
    // Safe to build unconditionally: a legacy booking has no sessions, so
    // this is an empty map and the non-legacy path naturally yields 0.
    const logsByAsset = checkoutSessionsToLogsByAsset(
      sessionsForBooking,
      (id) => byAsset.has(id)
    );

    for (const [assetId, slices] of byAsset) {
      const assetIsLegacyAllAtOnce =
        bookingIsLegacyAllAtOnce && checkedOutAssetIds.has(assetId);
      const claimedBySlice = assetIsLegacyAllAtOnce
        ? null
        : attributeDispositionsByBookingAsset({
            bookingAssetRows: slices,
            consumptionLogs: logsByAsset.get(assetId) ?? [],
          });

      const acc = breakdownByAsset.get(assetId) ?? { total: 0, standalone: 0 };
      for (const slice of slices) {
        const checkedOutSlice = assetIsLegacyAllAtOnce
          ? slice.quantity
          : Math.min(slice.quantity, claimedBySlice?.get(slice.id) ?? 0);
        acc.total += checkedOutSlice;
        // Standalone (free-pool) iff no kit FK — `!= null` matches
        // `attributeDispositionsByBookingAsset`'s kit-driven test.
        if (slice.assetKitId == null) {
          acc.standalone += checkedOutSlice;
        }
      }
      breakdownByAsset.set(assetId, acc);
    }
  }

  return breakdownByAsset;
}

/* -------------------------------------------------------------------------- */
/*                       buildInsufficientStockMessage                        */
/* -------------------------------------------------------------------------- */

/**
 * Standardized copy for an insufficient-availability rejection. Used by every
 * write guard so the shortfall message is byte-identical everywhere it
 * appears (server error, client-side `validationErrors` fallback).
 *
 * @param args.available - Units actually available (clamped to 0 for display).
 * @param args.total - `Asset.quantity` — the asset's total owned units.
 * @param args.unit - The asset's unit of measure; falls back to "units" when absent.
 * @returns The exact shortfall sentence, e.g. `"Only 3 of 10 boards available in this window — reduce the quantity to continue."`
 */
export function buildInsufficientStockMessage({
  available,
  total,
  unit,
}: {
  available: number;
  total: number;
  unit?: string | null;
}): string {
  const clamped = Math.max(0, available);
  return `Only ${clamped} of ${total} ${
    unit || "units"
  } available in this window — reduce the quantity to continue.`;
}

/* -------------------------------------------------------------------------- */
/*                       assertAssetQuantityAvailable                        */
/* -------------------------------------------------------------------------- */

/** Arguments for {@link assertAssetQuantityAvailable}. */
type AssertAssetQuantityAvailableArgs = {
  /** The asset being adjusted. */
  assetId: string;
  /** Caller's organization — scopes the underlying availability read. */
  organizationId: string;
  /** Prisma transaction the guard's read must run inside, so it commits atomically with the mutation. */
  tx: PrismaClientOrTx;
  /** Booking window to measure availability over (`null` for an unwindowed check). */
  window: AssetAvailabilityWindow;
  /** Exclude this booking's own reservation from the availability read. */
  excludeBookingId?: string;
  /** The row's quantity before this submission. */
  currentQuantity: number;
  /** The row's quantity as submitted by the caller. */
  requestedQuantity: number;
  /** Asset title, surfaced in `additionalData` for debugging. */
  assetTitle: string;
  /** Asset's unit of measure, used in the shortfall message. */
  unitOfMeasure?: string | null;
};

/**
 * Directional availability guard for a single asset's quantity on a booking.
 *
 * A reduction (`requestedQuantity ≤ currentQuantity`) can never oversubscribe
 * the pool and always passes — this is the #2725 recovery fix: without this
 * rule, a booking that became over-reserved (e.g. after the asset's total
 * quantity was lowered elsewhere) could never be edited back down, because an
 * absolute availability check would reject even a reduction. Only the
 * *increase* portion of a submission is measured against windowed
 * availability. Call inside the mutation's own transaction, behind
 * `lockAssetForQuantityUpdate`, so the read-then-decide is race-safe.
 *
 * @param args - See {@link AssertAssetQuantityAvailableArgs}.
 * @throws {ShelfError} 400 (`shouldBeCaptured: false`) when the increase exceeds availability.
 */
export async function assertAssetQuantityAvailable({
  assetId,
  organizationId,
  tx,
  window,
  excludeBookingId,
  currentQuantity,
  requestedQuantity,
  assetTitle,
  unitOfMeasure,
}: AssertAssetQuantityAvailableArgs): Promise<void> {
  // A reduction (or no-op) can never oversubscribe the pool → always allowed.
  // This is the #2725 recovery: an already-over-committed booking can still be
  // edited back down.
  if (requestedQuantity <= currentQuantity) return;

  const { bookable, total } = await getAssetAvailability({
    assetId,
    organizationId,
    window,
    excludeBookingId,
    db: tx,
  });

  // The verdict (allowed vs oversubscribed) comes from the pure package guard.
  // `bookable` EXCLUDES this booking (via `excludeBookingId`), so it is the
  // ABSOLUTE maximum this booking may hold given every OTHER overlapping
  // commitment — the full requested amount competes against it, not just the
  // delta. Comparing the delta (`requested − current > bookable`) would
  // double-count this booking's own headroom and allow it to grow to
  // `current + bookable`, oversubscribing the pool by `current` units. The
  // thrown message + `additionalData` stay app-side so the exact
  // (webapp-specific) shortfall copy `buildInsufficientStockMessage` produces
  // is preserved — the package's own message differs and is deliberately unused.
  const verdict = checkQuantityAvailable({
    requestedQuantity,
    currentQuantity,
    bookable,
    assetTitle,
    unitOfMeasure,
  });
  if (!verdict.ok) {
    throw new ShelfError({
      cause: null,
      title: "Insufficient availability",
      // `available` is `bookable` — the true max this booking may hold once
      // other overlapping bookings are accounted for.
      message: buildInsufficientStockMessage({
        available: bookable,
        total,
        unit: unitOfMeasure,
      }),
      additionalData: {
        assetId,
        assetTitle,
        requestedQuantity,
        currentQuantity,
        bookable,
      },
      label: "Booking",
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                      assertAssetQuantitiesAvailable                        */
/* -------------------------------------------------------------------------- */

/**
 * One asset's requested-quantity check, as input to
 * {@link assertAssetQuantitiesAvailable}.
 */
export type AssetQuantityCheckItem = {
  /** The asset being adjusted. */
  assetId: string;
  /** The row's quantity as submitted by the caller. */
  requestedQuantity: number;
  /**
   * The row's existing quantity for THIS booking on this asset, before this
   * submission. Defaults to `0` when omitted — a brand-new booking has
   * nothing existing to compare against, so its request is checked
   * ABSOLUTELY (equivalent to "increasing from 0"). Enables the same
   * directional rule as {@link assertAssetQuantityAvailable}: a
   * reduction/no-op against the row's own prior quantity can never
   * oversubscribe the pool and always passes.
   */
  currentQuantity?: number;
  /** Asset title, surfaced in the aggregated shortfall message + `additionalData`. */
  assetTitle: string;
  /** Asset's unit of measure, used in the shortfall message line. */
  unitOfMeasure?: string | null;
};

/** Arguments shared by every item in a {@link assertAssetQuantitiesAvailable} call. */
type AssertAssetQuantitiesAvailableCommonArgs = {
  /** Caller's organization — scopes the underlying batched availability read. */
  organizationId: string;
  /** Prisma transaction the guard's batched read must run inside, so it commits atomically with the mutation. */
  tx: AvailabilityBatchClient;
  /** Booking window to measure availability over (`null` for an unwindowed check). */
  window: AssetAvailabilityWindow;
  /** Exclude this booking's own reservation from the availability read. */
  excludeBookingId?: string;
};

/** One asset's shortfall detail, collected for the aggregated error's `additionalData`. */
type AssetQuantityShortfall = {
  assetId: string;
  assetTitle: string;
  requestedQuantity: number;
  /** Signed `bookable` from the batch read (display callers should clamp; the message line clamps inline). */
  bookable: number;
  total: number;
  unitOfMeasure?: string | null;
};

/**
 * Batched sibling of {@link assertAssetQuantityAvailable}: validates MANY
 * QUANTITY_TRACKED assets' requested quantities against the windowed pool in
 * a SINGLE {@link getAssetAvailabilityBatch} read, instead of fanning out one
 * `getAssetAvailability` call per asset (the shape a naive per-asset loop —
 * e.g. `checkoutBookingWritesWithinTx`'s existing guard — uses today). Booking
 * write paths that validate several QT assets at once in the same submission
 * (`createBooking`, `reserveBooking`, `updateBookingAssets`) should call this,
 * not loop {@link assertAssetQuantityAvailable}.
 *
 * Same directional rule per item as the singular guard: a reduction/no-op
 * (`requestedQuantity <= currentQuantity`) can never oversubscribe the pool
 * and is always allowed for that item WITHOUT comparing it against
 * `bookable` — only items requesting an INCREASE over their own prior
 * quantity are measured. `currentQuantity` defaults to `0`, so a brand-new
 * booking (nothing existing to compare against) is checked absolutely. The
 * batched availability read itself still runs for every requested asset
 * regardless of directionality (one fixed-cost read), but only the
 * increasing items can fail it.
 *
 * Every failing item is collected and reported together in ONE aggregated
 * `ShelfError`, mirroring `checkoutBookingWritesWithinTx`'s existing
 * multi-line shortfall message — the operator sees every asset that needs
 * adjusting in one pass instead of fixing them one rejection at a time. Call
 * inside the mutation's own transaction, with each asset already behind
 * `lockAssetForQuantityUpdate`, so the read-then-decide is race-safe (same
 * contract as the singular guard).
 *
 * @param items - The assets + requested quantities to validate. Empty is a no-op (no read is issued).
 * @param common - Shared arguments — see {@link AssertAssetQuantitiesAvailableCommonArgs}.
 * @throws {ShelfError} 400 (`shouldBeCaptured: false`) aggregating every asset whose increase exceeds availability.
 */
export async function assertAssetQuantitiesAvailable(
  items: AssetQuantityCheckItem[],
  {
    organizationId,
    tx,
    window,
    excludeBookingId,
  }: AssertAssetQuantitiesAvailableCommonArgs
): Promise<void> {
  // Nothing to check → nothing to read. Mirrors `getAssetAvailabilityBatch`'s
  // own empty-input short-circuit so callers can invoke this unconditionally.
  if (items.length === 0) return;

  // ONE batched read for every asset in `items` — never a per-item call to
  // the singular `getAssetAvailability` primitive (that would reintroduce
  // the exact N+1 fan-out this sibling exists to avoid).
  const availabilityByAsset = await getAssetAvailabilityBatch(
    items.map((item) => item.assetId),
    { organizationId, window, excludeBookingId, db: tx }
  );

  const shortfalls: AssetQuantityShortfall[] = [];

  for (const item of items) {
    // An asset id the batch read couldn't resolve (should not happen for an
    // id the caller validated itself, but this primitive makes no such
    // assumption) is treated as zero bookable — the conservative reading,
    // never silently skipped.
    const availability = availabilityByAsset.get(item.assetId);
    const bookable = availability?.bookable ?? 0;
    const total = availability?.total ?? 0;

    // Per-item verdict from the pure package guard, same directional rule as
    // the singular guard: a reduction/no-op against this row's own prior
    // quantity is always allowed (the #2725 recovery, without even touching
    // `bookable`), and — since `bookable` already EXCLUDES this booking (via
    // `excludeBookingId`) — an increase competes against the full pool, not
    // just the delta over `current`. `currentQuantity` defaults to `0` inside
    // the package guard, so a brand-new booking's item is checked absolutely.
    // The aggregated shortfall message stays app-side (its webapp-specific
    // multi-line copy differs from the package's), so `verdict.message` is
    // deliberately unused — only the ok/not-ok decision is taken from it.
    const verdict = checkQuantityAvailable({
      requestedQuantity: item.requestedQuantity,
      currentQuantity: item.currentQuantity,
      bookable,
    });
    if (!verdict.ok) {
      shortfalls.push({
        assetId: item.assetId,
        assetTitle: item.assetTitle,
        requestedQuantity: item.requestedQuantity,
        bookable,
        total,
        unitOfMeasure: item.unitOfMeasure,
      });
    }
  }

  if (shortfalls.length === 0) return;

  const lines = shortfalls.map(
    (s) =>
      `"${s.assetTitle}": requested ${s.requestedQuantity}, only ${Math.max(
        0,
        s.bookable
      )} of ${s.total} ${s.unitOfMeasure || "units"} available in this window`
  );

  throw new ShelfError({
    cause: null,
    label: "Booking",
    status: 400,
    shouldBeCaptured: false,
    message: `Some quantity-tracked assets don't fit the pool for these dates:\n${lines.join(
      "\n"
    )}\nPlease reduce the quantities before continuing.`,
    additionalData: { shortfalls },
  });
}
