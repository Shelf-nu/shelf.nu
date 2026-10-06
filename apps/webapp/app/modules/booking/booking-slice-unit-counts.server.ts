/**
 * Booking Slice Unit Counts
 *
 * Counts, for every quantity-tracked `BookingAsset` slice on a booking, how
 * many of its booked units have been checked out and how many have been
 * returned, consumed, lost or damaged. The booking overview renders these on
 * its rows and sorts on them, and the mobile booking detail orders its assets
 * by them, so both read them from here and never count a slice differently.
 *
 * Pure: the caller reads the slices, the disposition logs and the check-out
 * sessions, and keeps control of its own queries.
 *
 * @see {@link file://./checkout-attribution.ts} the session parser and the greedy attributor
 * @see {@link file://./service.server.ts} attributeCategorizedDispositionsByBookingAsset
 * @see {@link file://../../routes/_layout+/bookings.$bookingId.overview.tsx}
 * @see {@link file://../../routes/api+/mobile+/bookings.$bookingId.ts}
 */
import {
  attributeDispositionsByBookingAsset,
  BOOKING_DISPOSITION_CATEGORIES,
  checkoutSessionsToLogsByAsset,
  type CheckoutSession,
} from "./checkout-attribution";
import {
  attributeCategorizedDispositionsByBookingAsset,
  type DispositionCategoryBreakdown,
} from "./service.server";

// Defined in the pure attribution module so readers that must not load the
// booking service (it would close an import cycle) can share it.
export { BOOKING_DISPOSITION_CATEGORIES } from "./checkout-attribution";

/** One of {@link BOOKING_DISPOSITION_CATEGORIES}. */
type BookingDispositionCategory =
  (typeof BOOKING_DISPOSITION_CATEGORIES)[number];

/** Narrows a `ConsumptionLog` category to the ones a disposition counts. */
function isBookingDispositionCategory(
  category: string
): category is BookingDispositionCategory {
  return (BOOKING_DISPOSITION_CATEGORIES as readonly string[]).includes(
    category
  );
}

/** One slice of a quantity-tracked asset on the booking. */
export type QtyBookingAssetRow = {
  /** The `BookingAsset.id`. */
  id: string;
  /** Units booked on this slice. */
  quantity: number;
  /** `null` for the standalone slice, the `AssetKit.id` for a kit-driven one. */
  assetKitId: string | null;
};

/** A `ConsumptionLog` row recorded against the booking. */
export type BookingDispositionLog = {
  assetId: string;
  /** The slice the log names, or `null` when it names only the asset. */
  bookingAssetId: string | null;
  category: string;
  quantity: number;
};

/** Per-slice unit counts, keyed by `BookingAsset.id`. */
export type BookingSliceUnitCounts = {
  /** Units each slice has checked out. */
  checkedOutByBookingAsset: Map<string, number>;
  /** Units each slice has had returned, consumed, lost or damaged. */
  dispositionedByBookingAsset: Map<string, number>;
  /** The same dispositioned units, split by category. */
  breakdownByBookingAsset: Map<string, DispositionCategoryBreakdown>;
};

/**
 * Counts the checked-out and dispositioned units of every quantity-tracked
 * slice on a booking.
 *
 * A log or session entry that names its slice lands on that slice. One that
 * names only the asset is spread across the asset's slices, standalone first,
 * each up to its booked quantity. Dispositions are spread across all four
 * categories at once, because the slices' capacity is shared between them: a
 * pass per category would refill every slice for each category.
 *
 * Only assets in `bookingAssetRowsByAsset` are counted; sessions and logs for
 * any other asset are ignored. Every slice in the map gets an entry in each
 * result, zero when nothing names it.
 *
 * @param args.bookingAssetRowsByAsset - Each quantity-tracked asset's slices on
 *   the booking, keyed by asset id.
 * @param args.dispositionLogs - The booking's disposition logs for those
 *   assets.
 * @param args.checkoutSessions - The booking's `PartialBookingCheckout` rows.
 * @returns The per-slice counts, keyed by `BookingAsset.id`.
 */
export function computeBookingSliceUnitCounts({
  bookingAssetRowsByAsset,
  dispositionLogs,
  checkoutSessions,
}: {
  bookingAssetRowsByAsset: ReadonlyMap<string, QtyBookingAssetRow[]>;
  dispositionLogs: BookingDispositionLog[];
  checkoutSessions: CheckoutSession[];
}): BookingSliceUnitCounts {
  const logsByAsset = new Map<
    string,
    Array<{
      bookingAssetId: string | null;
      category: BookingDispositionCategory;
      quantity: number;
    }>
  >();
  for (const log of dispositionLogs) {
    if (!isBookingDispositionCategory(log.category)) continue;
    const logs = logsByAsset.get(log.assetId) ?? [];
    logs.push({
      bookingAssetId: log.bookingAssetId ?? null,
      category: log.category,
      quantity: log.quantity,
    });
    logsByAsset.set(log.assetId, logs);
  }

  // Parsed through the shared positional reader, so a session entry tagged with
  // its slice lands on it and an untagged one is spread.
  const checkoutLogsByAsset = checkoutSessionsToLogsByAsset(
    checkoutSessions,
    (assetId) => bookingAssetRowsByAsset.has(assetId)
  );

  const checkedOutByBookingAsset = new Map<string, number>();
  const dispositionedByBookingAsset = new Map<string, number>();
  const breakdownByBookingAsset = new Map<
    string,
    DispositionCategoryBreakdown
  >();

  // One asset's slices per call: an untagged entry is a single pool across the
  // rows it is handed, so two assets' rows together would share one pool.
  for (const [assetId, rows] of bookingAssetRowsByAsset) {
    const breakdowns = attributeCategorizedDispositionsByBookingAsset({
      bookingAssetRows: rows,
      consumptionLogs: logsByAsset.get(assetId) ?? [],
    });
    for (const [bookingAssetId, breakdown] of breakdowns) {
      breakdownByBookingAsset.set(bookingAssetId, breakdown);
      dispositionedByBookingAsset.set(
        bookingAssetId,
        breakdown.returned +
          breakdown.consumed +
          breakdown.lost +
          breakdown.damaged
      );
    }

    const checkedOut = attributeDispositionsByBookingAsset({
      bookingAssetRows: rows,
      consumptionLogs: checkoutLogsByAsset.get(assetId) ?? [],
    });
    for (const [bookingAssetId, units] of checkedOut) {
      checkedOutByBookingAsset.set(bookingAssetId, units);
    }
  }

  return {
    checkedOutByBookingAsset,
    dispositionedByBookingAsset,
    breakdownByBookingAsset,
  };
}
