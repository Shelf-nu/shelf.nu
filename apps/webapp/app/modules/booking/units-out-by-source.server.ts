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
import { attributeDispositionsByBookingAsset } from "./checkout-attribution";

/** A booking slice as the counter reads it. */
export type CountedSlice = {
  id: string;
  bookingId: string;
  assetId: string;
  quantity: number;
  assetKitId: string | null;
};

/**
 * Units still out on each sourced slice: what it checked out minus what has
 * come back on it (returned, used up, lost or damaged).
 *
 * Check-in logs are attributed per booking and asset exactly as the booking
 * page attributes them (`attributeDispositionsByBookingAsset`): a log naming
 * its slice counts for that slice, and a log naming none (an older phone app)
 * fills the asset's slices on that booking in the shared greedy order. So the
 * location page and the booking page never disagree about what is out.
 *
 * @param args.sourced - The slices to count, with their `checkedOutQuantity`
 * @param args.siblings - Every slice of those assets on those bookings
 * @param args.logs - Their disposition logs
 * @returns Units still out per sourced slice id
 */
export function unitsStillOutBySlice({
  sourced,
  siblings,
  logs,
}: {
  sourced: Array<CountedSlice & { checkedOutQuantity: number }>;
  siblings: CountedSlice[];
  logs: Array<{
    bookingId: string | null;
    assetId: string;
    bookingAssetId: string | null;
    quantity: number;
  }>;
}): Map<string, number> {
  const key = (bookingId: string | null, assetId: string) =>
    `${bookingId ?? ""}::${assetId}`;

  const slicesByGroup = new Map<string, CountedSlice[]>();
  for (const slice of siblings) {
    const group = slicesByGroup.get(key(slice.bookingId, slice.assetId)) ?? [];
    group.push(slice);
    slicesByGroup.set(key(slice.bookingId, slice.assetId), group);
  }
  const logsByGroup = new Map<string, typeof logs>();
  for (const log of logs) {
    const group = logsByGroup.get(key(log.bookingId, log.assetId)) ?? [];
    group.push(log);
    logsByGroup.set(key(log.bookingId, log.assetId), group);
  }

  const out = new Map<string, number>();
  const attributedByGroup = new Map<string, Map<string, number>>();
  for (const slice of sourced) {
    const groupKey = key(slice.bookingId, slice.assetId);
    let attributed = attributedByGroup.get(groupKey);
    if (!attributed) {
      attributed = attributeDispositionsByBookingAsset({
        bookingAssetRows: slicesByGroup.get(groupKey) ?? [slice],
        consumptionLogs: logsByGroup.get(groupKey) ?? [],
      });
      attributedByGroup.set(groupKey, attributed);
    }
    out.set(
      slice.id,
      Math.max(0, slice.checkedOutQuantity - (attributed.get(slice.id) ?? 0))
    );
  }
  return out;
}

/**
 * How many units of each pool are out on a booking right now having left from
 * one location: for every standalone slice on an ONGOING or OVERDUE booking
 * whose recorded source is `locationId`, the units still out on it (see
 * {@link unitsStillOutBySlice}).
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

  const sliceSelect = {
    id: true,
    bookingId: true,
    assetId: true,
    quantity: true,
    assetKitId: true,
  } as const;
  const sourced = await db.bookingAsset.findMany({
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
    select: { ...sliceSelect, checkedOutQuantity: true },
  });
  if (sourced.length === 0) return counts;

  const bookingIds = [...new Set(sourced.map((slice) => slice.bookingId))];
  const sourcedAssetIds = [...new Set(sourced.map((slice) => slice.assetId))];
  const [siblings, logs] = await Promise.all([
    db.bookingAsset.findMany({
      where: {
        bookingId: { in: bookingIds },
        assetId: { in: sourcedAssetIds },
        booking: { organizationId },
      },
      select: sliceSelect,
    }),
    db.consumptionLog.findMany({
      where: {
        // Booking ids come from the org-scoped read above.
        bookingId: { in: bookingIds },
        assetId: { in: sourcedAssetIds },
        category: { in: [...BOOKING_DISPOSITION_CATEGORIES] },
      },
      select: {
        bookingId: true,
        assetId: true,
        bookingAssetId: true,
        quantity: true,
      },
    }),
  ]);

  const stillOut = unitsStillOutBySlice({ sourced, siblings, logs });
  for (const slice of sourced) {
    const out = stillOut.get(slice.id) ?? 0;
    if (out > 0) {
      counts.set(slice.assetId, (counts.get(slice.assetId) ?? 0) + out);
    }
  }
  return counts;
}
