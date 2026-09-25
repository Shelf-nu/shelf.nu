/**
 * Units out on bookings, by the location they left from.
 *
 * The location page shows, next to a pool's count, how many of its units are
 * out on a booking having left from that location ("· 6 on a booking"). A
 * booking never changes a location's placed count, so this is information,
 * not a correction.
 *
 * The same numbers also lower what a location has left to hand out
 * (`unitsLeftAtSource`): units out on a booking from a location are not there
 * for custody to take. So this module is read by the custody source loaders,
 * and imports nothing from the booking service to keep that import one-way.
 *
 * @see {@link file://./checkout-source-location.server.ts} where the source is recorded
 * @see {@link file://../../routes/_layout+/locations.$locationId.assets.tsx} the reader
 */

import { BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ExtendedPrismaClient } from "~/database/db.server";

import {
  attributeDispositionsByBookingAsset,
  BOOKING_DISPOSITION_CATEGORIES,
} from "./checkout-attribution";

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

/** Client this module reads through: the root `db` or a transaction. */
type BookedOutClient = Pick<
  ExtendedPrismaClient,
  "bookingAsset" | "consumptionLog"
>;

/** Units of one pool still out on bookings, having left from one location. */
export type BookedOutFromLocation = { locationId: string; quantity: number };

/**
 * For each pool, the units still out on ONGOING or OVERDUE bookings per
 * location they left from: every standalone slice with a recorded source,
 * minus what has come back on it (see {@link unitsStillOutBySlice}).
 *
 * Kit slices are left out: their units belong to the kit, never to a manual
 * placement. So are slices with no recorded source.
 *
 * @param client - `db`, or the caller's transaction so the read sees its lock
 * @param args.assetIds - Pools the caller has already proven belong to the
 *   organization (a locked row or an org-scoped list)
 * @param args.organizationId - Extra scope when the caller has it
 * @param args.locationId - Only slices that left from this location
 * @returns Per asset id, the non-zero units out per location
 */
export async function loadBookedOutBySource(
  client: BookedOutClient,
  {
    assetIds,
    organizationId,
    locationId,
  }: { assetIds: string[]; organizationId?: string; locationId?: string }
): Promise<Map<string, BookedOutFromLocation[]>> {
  const result = new Map<string, BookedOutFromLocation[]>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return result;

  const sliceSelect = {
    id: true,
    bookingId: true,
    assetId: true,
    quantity: true,
    assetKitId: true,
  } as const;
  const sourced = await client.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      assetKitId: null,
      sourceLocationId: locationId ?? { not: null },
      checkedOutQuantity: { gt: 0 },
      booking: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
    },
    select: {
      ...sliceSelect,
      checkedOutQuantity: true,
      sourceLocationId: true,
    },
  });
  if (sourced.length === 0) return result;

  const bookingIds = [...new Set(sourced.map((slice) => slice.bookingId))];
  const sourcedAssetIds = [...new Set(sourced.map((slice) => slice.assetId))];
  const [siblings, logs] = await Promise.all([
    client.bookingAsset.findMany({
      where: {
        bookingId: { in: bookingIds },
        assetId: { in: sourcedAssetIds },
      },
      select: sliceSelect,
    }),
    client.consumptionLog.findMany({
      where: {
        // Booking and asset ids come from the scoped read above.
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
  const byAssetAndLocation = new Map<string, Map<string, number>>();
  for (const slice of sourced) {
    const out = stillOut.get(slice.id) ?? 0;
    if (out <= 0 || !slice.sourceLocationId) continue;
    const perLocation =
      byAssetAndLocation.get(slice.assetId) ?? new Map<string, number>();
    perLocation.set(
      slice.sourceLocationId,
      (perLocation.get(slice.sourceLocationId) ?? 0) + out
    );
    byAssetAndLocation.set(slice.assetId, perLocation);
  }
  for (const [assetId, perLocation] of byAssetAndLocation) {
    result.set(
      assetId,
      [...perLocation].map(([id, quantity]) => ({ locationId: id, quantity }))
    );
  }
  return result;
}

/**
 * How many units of each pool are out on a booking right now having left from
 * one location, for the location page's "· N on a booking".
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
  const bookedOut = await loadBookedOutBySource(db, {
    assetIds,
    organizationId,
    locationId,
  });
  const counts = new Map<string, number>();
  for (const [assetId, rows] of bookedOut) {
    counts.set(
      assetId,
      rows.reduce((sum, row) => sum + row.quantity, 0)
    );
  }
  return counts;
}
