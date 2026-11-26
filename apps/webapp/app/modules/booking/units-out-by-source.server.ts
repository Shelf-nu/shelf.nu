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

import { resolveSentUnits } from "./checkin-receipt";
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
  /** Units sent out on it so far, cumulative across trips. */
  checkedOutQuantity: number;
  /** When the slice was last dispatched; `null` when it never was. */
  checkedOutAt: Date | null;
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
  sourced: CountedSlice[];
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
      // A slice absorbs at most the units it sent (`resolveSentUnits`), the
      // capacity the check-in writer and the booking page use. Cumulative, so
      // untagged returns from a later trip still find room; and nothing for a
      // slice that never left, so a return cannot land on it.
      attributed = attributeDispositionsByBookingAsset({
        bookingAssetRows: (slicesByGroup.get(groupKey) ?? [slice]).map(
          (row) => ({
            id: row.id,
            assetKitId: row.assetKitId,
            quantity: resolveSentUnits({
              quantity: row.quantity,
              checkedOutAt: row.checkedOutAt,
              checkedOutQuantity: row.checkedOutQuantity,
            }),
          })
        ),
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
 * location they left from, for LEGACY groups only: every standalone LEGACY
 * slice with a recorded source, minus what has come back on it (see
 * {@link unitsStillOutBySlice}).
 *
 * Converted groups are left out: their units out are the `outQuantity` of
 * their LOCATION / UNPLACED source rows, which readers add themselves (see
 * `loadPhysicalNow` in `./sources/capacity.server`). A group is all LEGACY or
 * has no LEGACY slice, so filtering slices by mode filters whole groups.
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

  const sourced = await client.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      ...LEGACY_SOURCED_SLICE_WHERE,
      sourceLocationId: locationId ?? { not: null },
      booking: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
    },
    select: {
      ...SLICE_SELECT,
      checkedOutQuantity: true,
      sourceLocationId: true,
    },
  });
  return bookedOutFromLegacySourcedSlices(client, sourced);
}

/** The slice fields the booked-out counters read. */
const SLICE_SELECT = {
  id: true,
  bookingId: true,
  assetId: true,
  quantity: true,
  assetKitId: true,
  checkedOutAt: true,
} as const;

/**
 * The filter of a LEGACY slice whose units left from a recorded manual
 * placement: standalone, never came with a kit (kit slices and detached kit
 * residue record the kit's location, see `isManualSourceSlice`), with a
 * recorded source and something sent out. Callers add the asset and booking
 * scope.
 */
export const LEGACY_SOURCED_SLICE_WHERE = {
  assetKitId: null,
  sourceKitId: null,
  sourceAllocation: "LEGACY",
  sourceLocationId: { not: null },
  checkedOutQuantity: { gt: 0 },
} as const;

/**
 * A LEGACY slice with a recorded source, as the booked-out counter reads it.
 * `checkedOutAt` is optional: {@link LEGACY_SOURCED_SLICE_WHERE} requires
 * `checkedOutQuantity > 0`, so the units such a slice sent are its counted
 * departures and never fall back to the dispatch marker.
 */
export type LegacySourcedSlice = Omit<CountedSlice, "checkedOutAt"> & {
  checkedOutAt?: Date | null;
  checkedOutQuantity: number;
  sourceLocationId: string | null;
};

/**
 * Units still out per pool and location for LEGACY slices already read with
 * {@link LEGACY_SOURCED_SLICE_WHERE} on ONGOING or OVERDUE bookings: what each
 * checked out minus what came back on it (see {@link unitsStillOutBySlice}).
 * Two queries (siblings and logs, in parallel), none when no slice is given.
 *
 * @param client - `db`, or the caller's transaction
 * @param sourced - The sourced LEGACY slices
 * @returns Per asset id, the non-zero units out per location
 */
export async function bookedOutFromLegacySourcedSlices(
  client: BookedOutClient,
  sourced: LegacySourcedSlice[]
): Promise<Map<string, BookedOutFromLocation[]>> {
  const result = new Map<string, BookedOutFromLocation[]>();
  if (sourced.length === 0) return result;
  const sliceSelect = SLICE_SELECT;

  const bookingIds = [...new Set(sourced.map((slice) => slice.bookingId))];
  const sourcedAssetIds = [...new Set(sourced.map((slice) => slice.assetId))];
  const [siblings, logs] = await Promise.all([
    client.bookingAsset.findMany({
      where: {
        bookingId: { in: bookingIds },
        assetId: { in: sourcedAssetIds },
      },
      select: { ...sliceSelect, checkedOutQuantity: true },
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

  const stillOut = unitsStillOutBySlice({
    sourced: sourced.map((slice) => ({
      ...slice,
      checkedOutAt: slice.checkedOutAt ?? null,
    })),
    siblings,
    logs,
  });
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
 * LEGACY groups count through {@link loadBookedOutBySource}; converted groups
 * through the `outQuantity` of their LOCATION source rows at this location on
 * ONGOING or OVERDUE bookings. KIT rows never count. Two reads in parallel;
 * the converted read is one empty indexed query while no group is converted.
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
  const [bookedOut, convertedOut] = await Promise.all([
    loadBookedOutBySource(db, { assetIds, organizationId, locationId }),
    loadConvertedOutNow(db, { organizationId, locationId, assetIds }),
  ]);
  const counts = new Map<string, number>();
  for (const [assetId, rows] of bookedOut) {
    counts.set(
      assetId,
      rows.reduce((sum, row) => sum + row.quantity, 0)
    );
  }
  for (const { assetId, quantity } of convertedOut) {
    counts.set(assetId, (counts.get(assetId) ?? 0) + quantity);
  }
  return counts;
}

/** Units out now from one loose source row of a converted slice. */
export type ConvertedOutNow = {
  assetId: string;
  kind: "LOCATION" | "UNPLACED";
  /** The location for a LOCATION row; null for UNPLACED. */
  locationId: string | null;
  quantity: number;
};

/**
 * A slice a caller already read for {@link loadConvertedOutNow}. Mode and
 * booking status are re-checked when present, so a caller may hand over a
 * read that also holds LEGACY slices or non-physical bookings.
 */
export type ConvertedOutSliceRef = {
  id: string;
  assetId: string;
  sourceAllocation?: string;
  booking?: { status: BookingStatus } | null;
};

/** The client {@link loadConvertedOutNow} reads through. */
type ConvertedOutTx = Pick<
  ExtendedPrismaClient,
  "bookingAsset" | "bookingAssetSource"
>;

/** Statuses whose units are physically out. */
const PHYSICAL_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * True for an AUTO or MANUAL slice on an ONGOING or OVERDUE booking. Terminal
 * and reserved bookings have nothing physically out, whatever their rows
 * still say.
 */
function isConvertedAndOut(slice: ConvertedOutSliceRef): boolean {
  const converted =
    slice.sourceAllocation === undefined ||
    slice.sourceAllocation === "AUTO" ||
    slice.sourceAllocation === "MANUAL";
  const physical =
    !slice.booking || PHYSICAL_BOOKING_STATUSES.includes(slice.booking.status);
  return converted && physical;
}

/**
 * Units out right now on converted groups, per pool and loose source: the
 * `outQuantity` of LOCATION and UNPLACED source rows whose AUTO or MANUAL
 * slice is on an ONGOING or OVERDUE booking. KIT rows and kit slices never
 * count, so a kit departure never lowers loose units.
 *
 * The one reader of converted units out now: physical-now, the units-out
 * snapshot behind custody and check-out, and the location page all count
 * through it.
 *
 * Queries, by what the caller has:
 * - `slices` given (a read the caller shares with its LEGACY half): the
 *   source rows only (one, none when no slice is converted and out);
 * - `locationId` given: the source rows at that location first, on the
 *   (organizationId, locationId) index, then their slices (one, only when
 *   rows exist), so a page with no converted group pays one empty read;
 * - otherwise: the converted slices, then their rows (one, only when a slice
 *   is out).
 *
 * @param tx - The caller's transaction, or `db` for a read-only loader
 * @param args.organizationId - Scopes both reads when given; a caller
 *   without it has proven the pools belong to the workspace
 * @param args.assetIds - The pools to read
 * @param args.locationId - Only LOCATION rows at this location
 * @param args.slices - Slices the caller already read; skips the slice read
 * @returns One entry per source row with units out
 */
export async function loadConvertedOutNow(
  tx: ConvertedOutTx,
  args: {
    organizationId?: string;
    assetIds: string[];
    locationId?: string;
    slices?: ReadonlyArray<ConvertedOutSliceRef>;
  }
): Promise<ConvertedOutNow[]> {
  const { organizationId, locationId } = args;
  const ids = new Set(args.assetIds);
  if (ids.size === 0) return [];

  const orgScope = organizationId ? { organizationId } : {};
  const sliceWhere = {
    assetId: { in: [...ids] },
    sourceAllocation: { in: ["AUTO" as const, "MANUAL" as const] },
    booking: { ...orgScope, status: { in: PHYSICAL_BOOKING_STATUSES } },
  };
  const rowSelect = {
    bookingAssetId: true,
    kind: true,
    locationId: true,
    outQuantity: true,
  } as const;
  const rowScope = locationId
    ? { ...orgScope, kind: "LOCATION" as const, locationId }
    : {
        ...orgScope,
        kind: { in: ["LOCATION" as const, "UNPLACED" as const] },
      };

  let assetBySlice: Map<string, string>;
  let rows: Array<{
    bookingAssetId: string;
    kind: string;
    locationId: string | null;
    outQuantity: number;
  }>;
  if (locationId && !args.slices) {
    rows = await tx.bookingAssetSource.findMany({
      where: { ...rowScope, outQuantity: { gt: 0 } },
      select: rowSelect,
    });
    if (rows.length === 0) return [];
    const slices = await tx.bookingAsset.findMany({
      where: {
        ...sliceWhere,
        id: { in: [...new Set(rows.map((row) => row.bookingAssetId))] },
      },
      select: { id: true, assetId: true },
    });
    assetBySlice = new Map(slices.map((s) => [s.id, s.assetId]));
  } else {
    const slices: ReadonlyArray<ConvertedOutSliceRef> =
      args.slices ??
      (await tx.bookingAsset.findMany({
        where: sliceWhere,
        select: {
          id: true,
          assetId: true,
          booking: { select: { status: true } },
        },
      }));
    assetBySlice = new Map(
      slices
        .filter((s) => ids.has(s.assetId) && isConvertedAndOut(s))
        .map((s) => [s.id, s.assetId])
    );
    if (assetBySlice.size === 0) return [];
    rows = await tx.bookingAssetSource.findMany({
      where: {
        ...rowScope,
        // The slice ids come from the scoped read above.
        bookingAssetId: { in: [...assetBySlice.keys()] },
        outQuantity: { gt: 0 },
      },
      select: rowSelect,
    });
  }

  const out: ConvertedOutNow[] = [];
  for (const row of rows) {
    const assetId = assetBySlice.get(row.bookingAssetId);
    if (!assetId || row.outQuantity <= 0) continue;
    // A location read asked for LOCATION rows at that location only, so the
    // row's source is the location asked for.
    if (locationId) {
      out.push({
        assetId,
        kind: "LOCATION",
        locationId,
        quantity: row.outQuantity,
      });
      continue;
    }
    let kind: ConvertedOutNow["kind"];
    if (row.kind === "LOCATION") kind = "LOCATION";
    else if (row.kind === "UNPLACED") kind = "UNPLACED";
    else continue;
    out.push({
      assetId,
      kind,
      locationId: kind === "LOCATION" ? row.locationId : null,
      quantity: row.outQuantity,
    });
  }
  return out;
}
