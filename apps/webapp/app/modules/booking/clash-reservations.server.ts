/**
 * The reservations that stand in the way of a booking keeping its items out
 * longer.
 *
 * Two readers share these queries: the extend guard in `service.server.ts`,
 * which refuses a later end that overlaps one of them, and the booking page
 * loader, which shows the first of them as the "free until" horizon and the
 * next reservation of every item still out. Both must agree on what counts
 * as a clash, so the where-clause lives here once.
 *
 * A clash is a RESERVED booking of this workspace that starts inside the
 * window and holds, by name, an asset this booking still has out, or any
 * membership of a kit this booking still has out. A kit is reserved as a
 * whole through any of its memberships, not only the ones this booking's
 * slices point at. Model reservations ("any unit of model X") name no asset
 * and are measured by the model pool guard instead.
 *
 * @see {@link file://./clashing-bookings.ts} the pure shaping of the rows
 * @see {@link file://./next-reservations.server.ts} the loader-side reader
 */
import type { Prisma } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import type { db } from "~/database/db.server";
import {
  describeClashingBookings,
  type ClashingBooking,
  type KitByMembershipId,
} from "./clashing-bookings";

/**
 * The extended client, or the transaction client the caller is already
 * inside; only the two models the queries touch are needed.
 */
export type ClashClient = Pick<
  typeof db | Parameters<Parameters<typeof db.$transaction>[0]>[0],
  "assetKit" | "booking"
>;

/** What a booking holds through kits, resolved to the kits themselves. */
export type HeldKits = {
  /** Every membership of every kit the booking holds through a kit. */
  membershipIds: string[];
  /** The kit behind each of those memberships. */
  kitByMembershipId: KitByMembershipId;
};

/**
 * Resolve the kit memberships a booking holds to every membership of those
 * kits, so a reservation of the kit through any other member is found too.
 *
 * @param client - The Prisma client, or the transaction the caller is in
 * @param organizationId - The workspace both bookings belong to
 * @param membershipIdsStillOut - `BookingAsset.assetKitId` of the slices
 * still out through a kit
 * @returns Every membership of the held kits, and the kit each belongs to
 */
export async function resolveHeldKits({
  client,
  organizationId,
  membershipIdsStillOut,
}: {
  client: ClashClient;
  organizationId: string;
  membershipIdsStillOut: string[];
}): Promise<HeldKits> {
  if (membershipIdsStillOut.length === 0) {
    return { membershipIds: [], kitByMembershipId: new Map() };
  }

  const heldMemberships = await client.assetKit.findMany({
    where: { id: { in: membershipIdsStillOut }, organizationId },
    select: { kitId: true, kit: { select: { name: true } } },
  });
  const kitNameById = new Map<string, string>();
  for (const m of heldMemberships) {
    kitNameById.set(m.kitId, m.kit?.name ?? "Kit");
  }
  const heldKitIds = [...kitNameById.keys()];
  if (heldKitIds.length === 0) {
    return { membershipIds: [], kitByMembershipId: new Map() };
  }

  const memberships = await client.assetKit.findMany({
    where: { kitId: { in: heldKitIds }, organizationId },
    select: { id: true, kitId: true },
  });
  const kitByMembershipId = new Map<string, { id: string; name: string }>();
  for (const m of memberships) {
    const name = kitNameById.get(m.kitId);
    if (m.kitId && name !== undefined) {
      kitByMembershipId.set(m.id, { id: m.kitId, name });
    }
  }
  return { membershipIds: memberships.map((m) => m.id), kitByMembershipId };
}

/**
 * The RESERVED bookings that start inside `(after, until]` and hold any of
 * the given assets by name, or any of the given kit memberships, with the
 * shared items named on each.
 *
 * @param client - The Prisma client, or the transaction the caller is in
 * @param organizationId - The workspace to search
 * @param bookingId - The booking being extended; never its own clash
 * @param activeAssetIds - Assets the booking still has out
 * @param heldKits - Output of {@link resolveHeldKits}
 * @param after - Reservations starting at or before this instant are not
 * clashes of the added days (exclusive)
 * @param until - Reservations starting after this instant are out of the
 * window (inclusive); omit for no upper bound
 * @returns The clashing bookings, earliest start first, with shared items
 */
export async function findClashingReservations({
  client,
  organizationId,
  bookingId,
  activeAssetIds,
  heldKits,
  after,
  until,
}: {
  client: ClashClient;
  organizationId: string;
  bookingId: string;
  activeAssetIds: string[];
  heldKits: HeldKits;
  after: Date;
  until?: Date;
}): Promise<ClashingBooking[]> {
  if (activeAssetIds.length === 0 && heldKits.membershipIds.length === 0) {
    return [];
  }

  const assetClause: Prisma.BookingAssetWhereInput = {
    assetId: { in: activeAssetIds },
  };
  const sliceClause: Prisma.BookingAssetWhereInput =
    heldKits.membershipIds.length > 0
      ? {
          OR: [assetClause, { assetKitId: { in: heldKits.membershipIds } }],
        }
      : assetClause;

  const rows = await client.booking.findMany({
    where: {
      id: { not: bookingId },
      organizationId,
      status: { in: [BookingStatus.RESERVED] },
      bookingAssets: { some: sliceClause },
      from: until ? { gt: after, lte: until } : { gt: after },
    },
    select: {
      id: true,
      name: true,
      from: true,
      bookingAssets: {
        where: sliceClause,
        select: {
          assetId: true,
          assetKitId: true,
          asset: { select: { title: true } },
        },
      },
    },
    orderBy: { from: "asc" },
  });

  return describeClashingBookings(rows, heldKits.kitByMembershipId);
}
