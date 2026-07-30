/**
 * Bookings-list "Stock conflict" detector.
 *
 * A booking has a STOCK CONFLICT when at least one of its QUANTITY_TRACKED
 * assets is OVER-COMMITTED — the peak concurrent reserved demand for that
 * asset (summed across every ACTIVE booking that reserves it, org-wide)
 * EXCEEDS that asset's EFFECTIVE POOL at some instant that overlaps the
 * booking's own `[from, to]` window.
 *
 * The effective pool is `max(0, total − inCustody − inKits)` — deliberately
 * the SAME pool `bookable` measures against in
 * `~/modules/asset/availability.server` (see that module's doc), NOT raw
 * `Asset.quantity`. This is a consistency requirement, not a nicety: the
 * per-row RED "Insufficient stock" badge already compares a booking's
 * quantity against `bookable`, so an asset with units held in operator
 * custody or earmarked to a kit can show a red row while a naive
 * `total`-only pill showed no conflict at all — a false negative at the very
 * surface meant to catch it. Threshold parity means the list pill is NEVER
 * looser than the row-level badge: `checkedOut` is deliberately NOT
 * subtracted a second time here (same reasoning `bookable` documents) —
 * ONGOING/OVERDUE demand is already captured by the windowed reserved-rows
 * sweep below.
 *
 * Deliberately reuses (never duplicates) the primitives that already own
 * this domain in `~/modules/asset/availability.server`:
 *   - {@link overCommittedWindows} — the pure event-sweep that turns a set of
 *     `{from, to, qty}` intervals into the actual over-committed time
 *     ranges (as opposed to {@link peakConcurrent}'s single peak number).
 *   - {@link buildActiveBookingWhere} — which bookings compete for an
 *     asset's pool (RESERVED/ONGOING/OVERDUE; OVERDUE unconditionally).
 *   - {@link resolveIntervalTo} — the OVERDUE→`FAR_FUTURE_SENTINEL` rule, so
 *     an unreturned unit keeps occupying every current/future window.
 *   - {@link RESERVATION_REDUCING_CATEGORIES} — which logged dispositions
 *     (RETURN/CONSUME/LOSS/DAMAGE) shrink a booking's remaining reserved
 *     quantity before it's swept.
 *   - {@link ACTIVE_BOOKING_STATUSES} — which booking statuses are eligible
 *     to be flagged in the first place.
 *
 * It exists to drive an amber "Stock conflict" pill on the bookings list so
 * a workspace can spot over-booked assets without opening every booking.
 *
 * @see {@link flagBookingStockConflicts} — the pure batched detector. Callers
 *   that already know each booking's standalone QUANTITY_TRACKED asset ids
 *   (e.g. a page that already loaded `bookingAssets`) call this directly.
 * @see {@link getStockConflictedBookingIds} — loader-facing wrapper that
 *   resolves `qtyAssetIds` itself from a bare `{id, status, from, to}[]`
 *   list, then delegates to {@link flagBookingStockConflicts}. This is what
 *   the bookings-list loaders (`bookings._index.tsx`,
 *   `assets.$assetId.bookings.tsx`) call.
 * @see file://../asset/availability.server.ts
 */
import type { BookingStatus, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import type {
  AvailabilityBatchClient,
  AvailabilityInterval,
} from "~/modules/asset/availability.server";
import {
  ACTIVE_BOOKING_STATUSES,
  buildActiveBookingWhere,
  overCommittedWindows,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
} from "~/modules/asset/availability.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

const label: ErrorLabel = "Booking";

/**
 * Minimal Prisma surface {@link flagBookingStockConflicts} needs — a `Pick`
 * of {@link AvailabilityBatchClient} rather than a fresh structural type, so
 * this module can never drift from the shape the availability primitives
 * already query with (`asset.findMany`, `bookingAsset.findMany`,
 * `consumptionLog.groupBy`, `custody.groupBy`, `assetKit.groupBy`).
 * `partialBookingCheckout` is intentionally excluded — this detector never
 * needs a separate `checkedOut` adjustment (see the module doc's threshold-
 * parity note).
 */
export type StockConflictDbClient = Pick<
  AvailabilityBatchClient,
  "asset" | "bookingAsset" | "consumptionLog" | "custody" | "assetKit"
>;

/** One row of the bookings-list input this detector evaluates. */
export type BookingForStockConflictCheck = {
  /** Booking id — echoed back in the returned Set when flagged. */
  id: string;
  /** Only RESERVED/ONGOING/OVERDUE bookings (see {@link ACTIVE_BOOKING_STATUSES}) are eligible to be flagged. */
  status: BookingStatus;
  /** Booking start — `null` (e.g. DRAFT) makes the booking ineligible. */
  from: Date | null;
  /** Booking end — `null` (e.g. DRAFT) makes the booking ineligible. */
  to: Date | null;
  /** Distinct QUANTITY_TRACKED asset ids reserved (standalone, non-kit-driven) by this booking. */
  qtyAssetIds: string[];
};

/** Arguments for {@link flagBookingStockConflicts}. */
type FlagBookingStockConflictsArgs = {
  /** The bookings-list page's rows to evaluate. */
  bookings: BookingForStockConflictCheck[];
  /** Caller's organization — scopes every asset/reservation query. */
  organizationId: string;
  /** Prisma client or active transaction; defaults to the global `db`. */
  db?: StockConflictDbClient;
};

/**
 * Half-open `[from, to)` overlap test — mirrors the end-exclusive convention
 * {@link overCommittedWindows} and {@link peakConcurrent} already use for
 * "does a booking ending exactly when another starts count as concurrent"
 * (it doesn't). Two ranges overlap iff each starts before the other ends.
 */
function overlapsHalfOpen(
  aFrom: Date,
  aTo: Date,
  bFrom: Date,
  bTo: Date
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

/**
 * Flags every booking in `bookings` that has a STOCK CONFLICT — see the
 * module doc for the exact definition. Runs in a FIXED small number of
 * queries regardless of how many bookings or distinct assets are passed in:
 *
 * 1. Filter to ELIGIBLE bookings only (active status per
 *    {@link ACTIVE_BOOKING_STATUSES}, both `from`/`to` set, at least one QT
 *    asset) — DRAFT/COMPLETE/CANCELLED/ARCHIVED and windowless bookings can
 *    never be flagged, so they're dropped before any query is built.
 * 2. Collect the distinct QT asset ids across those eligible bookings and
 *    batch-fetch, in ONE `Promise.all` (four queries total, still constant
 *    in the number of assets/bookings):
 *    - each asset's `quantity` (org-scoped) — the raw total;
 *    - every ACTIVE standalone (`assetKitId: null`) `BookingAsset` row for
 *      those assets, org-wide (via {@link buildActiveBookingWhere} with
 *      `window: null` — every active reservation regardless of date, NOT
 *      just ones overlapping any single booking's window, because the sweep
 *      below needs the asset's FULL reservation timeline);
 *    - Σ operator-custody `quantity` per asset (`custody.groupBy`,
 *      `kitCustodyId IS NULL` units only — mirrors `getAssetAvailability`'s
 *      `inCustody`);
 *    - Σ `AssetKit.quantity` per asset (`assetKit.groupBy` — mirrors
 *      `getAssetAvailability`'s `inKits`).
 *    Each reserved row's remaining quantity is then reduced by
 *    already-logged RETURN/CONSUME/LOSS/DAMAGE dispositions (ONE more
 *    batched query, grouped by `(bookingId, assetId)`, skipped entirely
 *    when there are no reserved rows), and its interval's `to` resolved via
 *    {@link resolveIntervalTo} (OVERDUE → sentinel).
 * 3. For each asset, compute its EFFECTIVE POOL —
 *    `max(0, total − inCustody − inKits)` (see the module doc's
 *    threshold-parity note) — and run {@link overCommittedWindows} ONCE over
 *    its full interval list against that pool to get the asset's
 *    over-committed time ranges. This naturally includes each eligible
 *    booking's OWN reservation, since that row is part of the same
 *    active-bookings read.
 * 4. For each eligible booking, flag it iff ANY of its QT assets has an
 *    over-committed window overlapping the booking's own `[from, to]`.
 *
 * @param args - See {@link FlagBookingStockConflictsArgs}.
 * @returns The `Set` of booking ids (from the input) that have a stock conflict.
 * @throws {ShelfError} If the underlying queries fail.
 */
export async function flagBookingStockConflicts({
  bookings,
  organizationId,
  db: dbOrTx,
}: FlagBookingStockConflictsArgs): Promise<Set<string>> {
  const flagged = new Set<string>();

  // Only ACTIVE bookings with a real window can ever be flagged — see the
  // module doc's eligibility rule.
  const eligibleBookings = bookings.filter(
    (b): b is BookingForStockConflictCheck & { from: Date; to: Date } =>
      (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(
        b.status
      ) &&
      b.from !== null &&
      b.to !== null &&
      b.qtyAssetIds.length > 0
  );
  if (eligibleBookings.length === 0) return flagged;

  const assetIds = [...new Set(eligibleBookings.flatMap((b) => b.qtyAssetIds))];
  if (assetIds.length === 0) return flagged;

  const client = (dbOrTx ?? db) as unknown as StockConflictDbClient;

  try {
    const [assetRows, reservedRows, custodyGroups, inKitsGroups] =
      await Promise.all([
        client.asset.findMany({
          where: { id: { in: assetIds }, organizationId },
          select: { id: true, quantity: true },
        }),
        client.bookingAsset.findMany({
          where: {
            assetId: { in: assetIds },
            // Kit-driven slices don't compete for the standalone pool this
            // detector measures against — mirrors the `assetKitId: null`
            // filter every availability read uses.
            assetKitId: null,
            // `window: null` — the FULL active-reservation timeline for
            // these assets, org-wide. Unlike `getAssetAvailabilityBatch`
            // (windowed around ONE target booking), this sweep needs every
            // active commitment so it can answer the question for MANY
            // differently dated bookings in a single pass.
            booking: buildActiveBookingWhere(organizationId, null),
          },
          select: {
            assetId: true,
            bookingId: true,
            quantity: true,
            booking: { select: { from: true, to: true, status: true } },
          },
        }),
        // Operator custody only (`kitCustodyId IS NULL` units) — org-scoped
        // through the asset relation, since `Custody` has no
        // `organizationId` column of its own. Mirrors
        // `getAssetAvailabilityBatch`'s identical `custody.groupBy` call.
        client.custody.groupBy({
          by: ["assetId"],
          where: {
            assetId: { in: assetIds },
            asset: { organizationId },
            // Operator custody only — kit-inherited custody is counted via
            // inKits (assetKit.groupBy below), so including it here would
            // double-deduct and produce false stock conflicts.
            kitCustodyId: null,
          },
          _sum: { quantity: true },
        }),
        // Units currently allocated into kits. Mirrors
        // `getAssetAvailabilityBatch`'s identical `assetKit.groupBy` call.
        client.assetKit.groupBy({
          by: ["assetId"],
          where: { assetId: { in: assetIds }, organizationId },
          _sum: { quantity: true },
        }),
      ]);

    const totalByAsset = new Map(assetRows.map((a) => [a.id, a.quantity ?? 0]));
    const inCustodyByAsset = new Map(
      custodyGroups.map((c) => [c.assetId, c._sum.quantity ?? 0])
    );
    const inKitsByAsset = new Map(
      inKitsGroups.map((k) => [k.assetId, k._sum.quantity ?? 0])
    );

    const intervalsByAsset = new Map<string, AvailabilityInterval[]>();

    if (reservedRows.length > 0) {
      const bookingIds = [...new Set(reservedRows.map((r) => r.bookingId))];

      // Mirrors `getAssetAvailabilityBatch`'s logged-dispositions read:
      // grouped by (bookingId, assetId) since this spans many assets.
      const loggedGroups = await client.consumptionLog.groupBy({
        by: ["bookingId", "assetId"],
        where: {
          assetId: { in: assetIds },
          bookingId: { in: bookingIds },
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
        // Defensive only: `Booking` is a required (non-nullable) relation on
        // `BookingAsset`, so a row with no `booking` should never occur in
        // practice — skip rather than fabricate a fallback window.
        if (!row.booking) continue;

        const logged = loggedByKey.get(`${row.bookingId}:${row.assetId}`) ?? 0;
        // Clamp at 0 per row, same defence-in-depth as the availability
        // primitives — an over-logged booking can't push demand negative.
        const remaining = Math.max(0, row.quantity - logged);
        if (remaining === 0) continue;

        // `windowTo` fallback is unreachable here (`row.booking.to` is
        // always defined whenever `row.booking` is) — passed through only
        // to satisfy `resolveIntervalTo`'s signature, matching how the
        // singular/batch availability primitives call it.
        const to = resolveIntervalTo(
          row.booking.status,
          row.booking.to,
          row.booking.to
        );

        let intervals = intervalsByAsset.get(row.assetId);
        if (!intervals) {
          intervals = [];
          intervalsByAsset.set(row.assetId, intervals);
        }
        intervals.push({ from: row.booking.from, to, qty: remaining });
      }
    }

    // One sweep per distinct asset — NOT per booking — regardless of how
    // many eligible bookings reference it.
    const overWindowsByAsset = new Map<
      string,
      Array<{ from: Date; to: Date }>
    >();
    for (const assetId of assetIds) {
      const total = totalByAsset.get(assetId) ?? 0;
      const inCustody = inCustodyByAsset.get(assetId) ?? 0;
      const inKits = inKitsByAsset.get(assetId) ?? 0;
      // The SAME pool `bookable` measures against (see the module doc's
      // threshold-parity note) — NOT raw `total`. Clamped at 0 so an asset
      // whose custody+kit allocations already exceed its total (should not
      // happen, but defence-in-depth) can't produce a negative threshold
      // that would flag every single reservation as "over".
      const effectivePool = Math.max(0, total - inCustody - inKits);
      const intervals = intervalsByAsset.get(assetId) ?? [];
      overWindowsByAsset.set(
        assetId,
        overCommittedWindows(intervals, effectivePool)
      );
    }

    for (const booking of eligibleBookings) {
      for (const assetId of booking.qtyAssetIds) {
        const windows = overWindowsByAsset.get(assetId);
        if (!windows || windows.length === 0) continue;
        const hasConflict = windows.some((w) =>
          overlapsHalfOpen(booking.from, booking.to, w.from, w.to)
        );
        if (hasConflict) {
          flagged.add(booking.id);
          break;
        }
      }
    }

    return flagged;
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while detecting booking stock conflicts. Please try again or contact support.",
      additionalData: { organizationId, bookingCount: bookings.length },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                       getStockConflictedBookingIds                         */
/* -------------------------------------------------------------------------- */

/** One row of the bookings-list LOADER's input — a bare booking, no asset ids attached. */
export type BookingForStockConflictLookup = {
  /** Booking id — echoed back in the returned Set when flagged. */
  id: string;
  /** Only RESERVED/ONGOING/OVERDUE bookings are ever eligible; see {@link flagBookingStockConflicts}. */
  status: BookingStatus;
  /** Booking start — `null` (e.g. DRAFT) makes the booking ineligible. */
  from: Date | null;
  /** Booking end — `null` (e.g. DRAFT) makes the booking ineligible. */
  to: Date | null;
};

/**
 * Minimal Prisma surface {@link getStockConflictedBookingIds} needs. Extends
 * {@link StockConflictDbClient} with a SECOND call shape on the same
 * `bookingAsset.findMany` delegate — this helper's own grouping query
 * (`select: { bookingId, assetId }`) alongside the shape
 * {@link flagBookingStockConflicts} already calls it with
 * (`select: { assetId, bookingId, quantity, booking: {...} }`). Intersecting
 * the two function types here composes them into one overloaded signature,
 * so a single mock `bookingAsset.findMany` in tests (or the real Prisma
 * delegate) can service both call sites without a second field on the type.
 */
export type StockConflictedBookingIdsDbClient = StockConflictDbClient & {
  bookingAsset: {
    findMany: (args: {
      where: Prisma.BookingAssetWhereInput;
      select: { bookingId: true; assetId: true };
    }) => Promise<Array<{ bookingId: string; assetId: string }>>;
  };
};

/** Arguments for {@link getStockConflictedBookingIds}. */
type GetStockConflictedBookingIdsArgs = {
  /** The bookings-list loader's rows to evaluate — bare `{id, status, from, to}`. */
  bookings: BookingForStockConflictLookup[];
  /** Caller's organization — scopes both the asset-id lookup and every downstream detector query. */
  organizationId: string;
  /** Prisma client or active transaction; defaults to the global `db`. */
  db?: StockConflictedBookingIdsDbClient;
};

/**
 * Loader-facing wrapper around {@link flagBookingStockConflicts} for callers
 * that don't already have each booking's standalone QUANTITY_TRACKED asset
 * ids in hand — i.e. the bookings-list loaders, which only select
 * `{id, status, from, to}` on each row before this call.
 *
 * Batch-fetches, in ONE query, every standalone (`assetKitId: null`)
 * `BookingAsset` row for the given bookings whose asset is
 * `QUANTITY_TRACKED` and belongs to the caller's organization, groups the
 * results into a `bookingId -> assetId[]` map, then delegates to
 * {@link flagBookingStockConflicts} (which re-fetches everything else itself
 * — asset totals, the full org-wide active-reservation timeline, logged
 * dispositions — so this wrapper never needs to touch any of that).
 *
 * Still a FIXED small number of queries regardless of how many bookings are
 * passed in: this grouping query, plus whatever fixed count
 * {@link flagBookingStockConflicts} issues internally.
 *
 * @param args - See {@link GetStockConflictedBookingIdsArgs}.
 * @returns The `Set` of booking ids (from the input) that have a stock
 *   conflict. Empty when `bookings` is empty or none of them reserve any
 *   QUANTITY_TRACKED asset.
 * @throws {ShelfError} If the underlying queries fail.
 */
export async function getStockConflictedBookingIds({
  bookings,
  organizationId,
  db: dbOrTx,
}: GetStockConflictedBookingIdsArgs): Promise<Set<string>> {
  if (bookings.length === 0) return new Set();

  const client = (dbOrTx ?? db) as unknown as StockConflictedBookingIdsDbClient;
  const bookingIds = bookings.map((b) => b.id);

  try {
    const qtyRows = await client.bookingAsset.findMany({
      where: {
        bookingId: { in: bookingIds },
        // Kit-driven slices don't compete for the standalone pool the
        // detector measures against — same filter `flagBookingStockConflicts`
        // itself applies to its own (separate) `bookingAsset.findMany` call.
        assetKitId: null,
        asset: { type: "QUANTITY_TRACKED", organizationId },
      },
      select: { bookingId: true, assetId: true },
    });

    if (qtyRows.length === 0) return new Set();

    const qtyAssetIdsByBooking = new Map<string, Set<string>>();
    for (const row of qtyRows) {
      let ids = qtyAssetIdsByBooking.get(row.bookingId);
      if (!ids) {
        ids = new Set<string>();
        qtyAssetIdsByBooking.set(row.bookingId, ids);
      }
      ids.add(row.assetId);
    }

    return await flagBookingStockConflicts({
      bookings: bookings.map((b) => ({
        id: b.id,
        status: b.status,
        from: b.from,
        to: b.to,
        qtyAssetIds: [...(qtyAssetIdsByBooking.get(b.id) ?? [])],
      })),
      organizationId,
      db: client,
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while resolving quantity-tracked assets for stock-conflict detection. Please try again or contact support.",
      additionalData: { organizationId, bookingCount: bookings.length },
      label,
    });
  }
}

/**
 * Loader helper: decorates a bookings-list page's rows with the
 * `hasStockConflict` flag that drives the amber "Stock conflict" pill.
 *
 * The pill is DECORATIVE, so a failure computing conflicts must never take the
 * whole bookings list down. {@link getStockConflictedBookingIds} throws on any
 * query error, so it is wrapped here in a try/catch: on failure every row is
 * returned with `hasStockConflict: false` and the error is logged, rather than
 * bubbling a 500 up through the loader. Centralizes the identical decoration
 * the five bookings-list loaders share (`bookings._index`, `me.bookings`,
 * `kits.$kitId.bookings`, `assets.$assetId.bookings`,
 * `settings.team.users.$userId.bookings`).
 *
 * @param args.bookings - The loader's booking rows (each needs at least
 *   `{ id, status, from, to }`; extra fields are preserved).
 * @param args.organizationId - Caller's organization — scopes every query.
 * @param args.db - Prisma client or active transaction; defaults to `db`.
 * @returns The same rows, each extended with `hasStockConflict: boolean`.
 */
export async function decorateBookingsWithStockConflicts<
  B extends BookingForStockConflictLookup,
>({
  bookings,
  organizationId,
  db: dbOrTx,
}: {
  bookings: B[];
  organizationId: string;
  db?: StockConflictedBookingIdsDbClient;
}): Promise<Array<B & { hasStockConflict: boolean }>> {
  let conflictedIds = new Set<string>();
  try {
    conflictedIds = await getStockConflictedBookingIds({
      bookings: bookings.map((b) => ({
        id: b.id,
        status: b.status,
        from: b.from,
        to: b.to,
      })),
      organizationId,
      db: dbOrTx,
    });
  } catch (cause) {
    // Decorative pill only — never fail the whole list because conflict
    // detection errored. Log and fall back to "no conflicts".
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Failed to compute booking stock conflicts; rendering the bookings list without the conflict pill.",
        additionalData: { organizationId, bookingCount: bookings.length },
        label,
      })
    );
  }

  return bookings.map((b) => ({
    ...b,
    hasStockConflict: conflictedIds.has(b.id),
  }));
}
