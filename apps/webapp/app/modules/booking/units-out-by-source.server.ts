/**
 * Units out on bookings, by the location they left from.
 *
 * The location page shows, next to a pool's count, how many of its units are
 * out on a booking having left from that location ("· 6 on a booking"). A
 * booking never changes a location's placed count, so this is information,
 * not a correction.
 *
 * Its own module because it reads the disposition categories from
 * `booking-slice-unit-counts.server`, which imports the booking service; the
 * booking service imports `checkout-source-location.server`, so the counter
 * cannot live there without an import cycle.
 *
 * @see {@link file://./checkout-source-location.server.ts} where the source is recorded
 * @see {@link file://../../routes/_layout+/locations.$locationId.assets.tsx} the reader
 */

import { BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";

import { BOOKING_DISPOSITION_CATEGORIES } from "./booking-slice-unit-counts.server";

/**
 * How many units of each pool are out on a booking right now having left from
 * one location: for every standalone slice on an ONGOING or OVERDUE booking
 * whose recorded source is `locationId`, the units checked out minus the
 * units already returned, used up, lost or damaged.
 *
 * Exact per slice: a slice gets a source only when it first goes out, and
 * every check-in log written since names its slice (`bookingAssetId`), so the
 * subtraction never has to guess which slice a log belongs to.
 *
 * Counts only; a booking never changes a location's placed count.
 *
 * @param args.organizationId - Scopes the read
 * @param args.locationId - The location page being viewed
 * @param args.assetIds - The pools listed on that page
 * @returns Units out per asset id; assets with none are absent
 */
export async function countUnitsOnBookingsFromLocation({
  organizationId,
  locationId,
  assetIds,
}: {
  organizationId: string;
  locationId: string;
  assetIds: string[];
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return counts;

  const slices = await db.bookingAsset.findMany({
    where: {
      sourceLocationId: locationId,
      assetKitId: null,
      assetId: { in: ids },
      checkedOutQuantity: { gt: 0 },
      booking: {
        organizationId,
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
    },
    select: { id: true, assetId: true, checkedOutQuantity: true },
  });
  if (slices.length === 0) return counts;

  const logs = await db.consumptionLog.findMany({
    where: {
      // Slice ids come from the org-scoped read above.
      bookingAssetId: { in: slices.map((slice) => slice.id) },
      category: { in: [...BOOKING_DISPOSITION_CATEGORIES] },
    },
    select: { bookingAssetId: true, quantity: true },
  });
  const backBySlice = new Map<string, number>();
  for (const log of logs) {
    if (!log.bookingAssetId) continue;
    backBySlice.set(
      log.bookingAssetId,
      (backBySlice.get(log.bookingAssetId) ?? 0) + log.quantity
    );
  }

  for (const slice of slices) {
    const out = Math.max(
      0,
      slice.checkedOutQuantity - (backBySlice.get(slice.id) ?? 0)
    );
    if (out > 0) {
      counts.set(slice.assetId, (counts.get(slice.assetId) ?? 0) + out);
    }
  }
  return counts;
}
