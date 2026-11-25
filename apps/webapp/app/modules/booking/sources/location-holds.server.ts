/**
 * Reads units reserved next at one location, per pool, for the location page
 * (read-only: no lock, no conversion).
 *
 * A pool's hold at a location is the pending units (`quantity -
 * releasedQuantity - outQuantity`) of its LOCATION source rows there, on AUTO
 * or MANUAL slices of RESERVED, ONGOING or OVERDUE bookings. Drafts hold
 * nothing, LEGACY slices hold nothing at a source, and KIT rows are never
 * read. The peak over the next booking window is
 * {@link reservedNextAtLocation}.
 *
 * @see {@link file://./location-holds.ts} the rule and the line
 * @see {@link file://../../../routes/_layout+/locations.$locationId.assets.tsx}
 */

import {
  ACTIVE_BOOKING_STATUSES,
  resolveIntervalTo,
} from "@shelf/quantity-control";

import { db } from "~/database/db.server";

import { reservedNextAtLocation } from "./location-holds";
import type { PendingHold } from "./location-holds";

/**
 * Units reserved next at a location for each listed pool.
 *
 * Queries: the converted slices of those pools on active bookings (one; it
 * is the fast-path probe and returns nothing while every group is LEGACY),
 * then their LOCATION rows at this location (one, only when slices exist).
 * Batched over the page's pools.
 *
 * @param args.organizationId - Scopes both reads
 * @param args.locationId - The location page being viewed
 * @param args.assetIds - The pools listed on that page
 * @param args.now - The current instant; defaults to the clock
 * @returns Units reserved next per asset id; pools with none are absent
 */
export async function loadReservedNextAtLocation({
  organizationId,
  locationId,
  assetIds,
  now = new Date(),
}: {
  organizationId: string;
  locationId: string;
  assetIds: string[];
  now?: Date;
}): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return result;

  const slices = await db.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      assetKitId: null,
      sourceAllocation: { in: ["AUTO", "MANUAL"] },
      booking: {
        organizationId,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
      },
    },
    select: {
      id: true,
      assetId: true,
      booking: { select: { from: true, to: true, status: true } },
    },
  });
  if (slices.length === 0) return result;

  const sliceById = new Map(slices.map((slice) => [slice.id, slice]));
  const rows = await db.bookingAssetSource.findMany({
    where: {
      organizationId,
      locationId,
      kind: "LOCATION",
      bookingAssetId: { in: [...sliceById.keys()] },
    },
    select: {
      bookingAssetId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });

  const holdsByAsset = new Map<string, PendingHold[]>();
  for (const row of rows) {
    const slice = sliceById.get(row.bookingAssetId);
    if (!slice?.booking) continue;
    const pending = row.quantity - row.releasedQuantity - row.outQuantity;
    if (pending <= 0) continue;
    const holds = holdsByAsset.get(slice.assetId) ?? [];
    holds.push({
      from: slice.booking.from,
      // An overdue booking's units have no known return: it holds on.
      to: resolveIntervalTo(
        slice.booking.status,
        slice.booking.to,
        slice.booking.to
      ),
      pending,
    });
    holdsByAsset.set(slice.assetId, holds);
  }

  for (const [assetId, holds] of holdsByAsset) {
    const reserved = reservedNextAtLocation(holds, now);
    if (reserved > 0) result.set(assetId, reserved);
  }
  return result;
}
