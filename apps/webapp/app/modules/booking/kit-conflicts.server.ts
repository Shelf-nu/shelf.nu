/**
 * Kit-level booking conflicts.
 *
 * A kit is one physical case, so it can only be in one overlapping booking at a
 * time — the same exclusivity an INDIVIDUAL asset has. The asset conflict rule
 * cannot provide it: it exempts QUANTITY_TRACKED assets, so a kit made only of
 * those would never conflict. This module finds which kits another overlapping
 * booking holds: for the booking write paths to refuse, and for the booking
 * kit pickers to leave out.
 *
 * @see {@link file://./helpers.ts} `hasKitBookingConflicts` — the decision rule
 * @see {@link file://./utils.server.ts} `createBookingConflictConditions` — the window
 */
import type { BookingStatus, Prisma } from "@prisma/client";
import { db, type ExtendedPrismaClient } from "~/database/db.server";
import { hasKitBookingConflicts, type KitBookingSlice } from "./helpers";
import {
  createBookingConflictConditions,
  stillOutOnOverdueKitSlice,
} from "./utils.server";

/** A kit another booking holds, named for the error the caller shows. */
export type ConflictingKit = { id: string; name: string };

/** The columns the conflict read selects for each kit-driven slice. */
type KitSliceRow = {
  assetKitId: string | null;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  booking: { id: string; status: BookingStatus };
};

/**
 * Finds the kits among `kitIds` that another booking holds for a window
 * overlapping `from`–`to`.
 *
 * A booking holds a kit through a LIVE kit-driven slice: `assetKitId` pointing
 * at one of the kit's `AssetKit` rows. A detached slice (`assetKitId` null) is a
 * standalone asset now and does not hold the kit. `assetKitId` is a bare FK with
 * no relation accessor, so the memberships are resolved first.
 *
 * @param args.kitIds - Kits the current booking holds or is about to take
 * @param args.bookingId - The current booking; its own slices never conflict
 * @param args.from - Start of the window to check; nothing conflicts without one
 * @param args.to - End of the window to check
 * @param args.organizationId - Scopes both reads
 * @param args.ignoreReservedConflicts - Pass only when the current booking is
 *   already in flight, so a reservation that has taken nothing cannot block it
 * @param client - Pass the active `tx` so the read shares the caller's transaction
 * @returns The conflicting kits, each once
 */
export async function findConflictingKits(
  {
    kitIds,
    bookingId,
    from,
    to,
    organizationId,
    ignoreReservedConflicts = false,
  }: {
    kitIds: string[];
    bookingId: string;
    from: Date | string | null | undefined;
    to: Date | string | null | undefined;
    organizationId: string;
    ignoreReservedConflicts?: boolean;
  },
  client: Pick<ExtendedPrismaClient, "assetKit" | "bookingAsset">
): Promise<ConflictingKit[]> {
  if (kitIds.length === 0 || !from || !to) return [];

  const memberships = await client.assetKit.findMany({
    where: { kitId: { in: kitIds }, organizationId },
    select: MEMBERSHIP_SELECT,
  });
  if (memberships.length === 0) return [];

  const slices = await findKitSlicesInWindow(
    {
      assetKitId: { in: memberships.map((m) => m.id) },
      bookingId,
      from,
      to,
      organizationId,
    },
    client
  );

  return judgeKitHolds({
    memberships,
    slices,
    bookingId,
    ignoreReservedConflicts,
  });
}

/**
 * Finds every kit in the organization that another booking holds for a window
 * overlapping `from`–`to`.
 *
 * The open-ended twin of {@link findConflictingKits}, for the booking kit
 * pickers: they have to leave out the kits another booking holds before they
 * know which kits are on the page. Judged by the same rule, on the kit's own
 * slices only. A slice under another kit, or a standalone slice of the same
 * asset, never holds this kit: a kit's `QUANTITY_TRACKED` units are its own
 * allocation (`AssetKit.quantity`), which no other slice draws on.
 *
 * @param args.bookingId - The booking being filled; its own slices never conflict
 * @param args.from - Start of the window to check; nothing is held without one
 * @param args.to - End of the window to check
 * @param args.organizationId - Scopes both reads
 * @param client - Prisma client or active transaction; defaults to the global `db`
 * @returns The held kits, each once
 */
export async function findKitsHeldByOtherBookings(
  {
    bookingId,
    from,
    to,
    organizationId,
  }: {
    bookingId: string;
    from: Date | string | null | undefined;
    to: Date | string | null | undefined;
    organizationId: string;
  },
  client: Pick<ExtendedPrismaClient, "assetKit" | "bookingAsset"> = db
): Promise<ConflictingKit[]> {
  if (!from || !to) return [];

  const slices = await findKitSlicesInWindow(
    { assetKitId: { not: null }, bookingId, from, to, organizationId },
    client
  );
  if (slices.length === 0) return [];

  // The query already excludes null; this only narrows the type.
  const membershipIds = [
    ...new Set(
      slices
        .map((slice) => slice.assetKitId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const memberships = await client.assetKit.findMany({
    where: { id: { in: membershipIds }, organizationId },
    select: MEMBERSHIP_SELECT,
  });

  return judgeKitHolds({ memberships, slices, bookingId });
}

/** The membership columns both lookups need to name a kit from a slice. */
const MEMBERSHIP_SELECT = {
  id: true,
  kitId: true,
  kit: { select: { name: true } },
} satisfies Prisma.AssetKitSelect;

type Membership = { id: string; kitId: string; kit: { name: string } };

/**
 * Reads the kit-driven slices that can hold a kit against `from`–`to`: those on
 * bookings overlapping the window (the same RESERVED / ONGOING / OVERDUE window
 * the asset conflict check uses), plus any still out on an OVERDUE booking
 * whatever its dates, since an overdue kit has no known return date. The
 * current booking is excluded from both.
 */
async function findKitSlicesInWindow(
  {
    assetKitId,
    bookingId,
    from,
    to,
    organizationId,
  }: {
    assetKitId: Prisma.StringNullableFilter;
    bookingId: string;
    from: Date | string;
    to: Date | string;
    organizationId: string;
  },
  client: Pick<ExtendedPrismaClient, "bookingAsset">
): Promise<KitSliceRow[]> {
  const { where: windowWhere } = createBookingConflictConditions({
    currentBookingId: bookingId,
    fromDate: from,
    toDate: to,
  });

  // why: `createBookingConflictConditions` types `where.booking` as the
  // relation-filter union, but it always builds a plain `BookingWhereInput`.
  const windowBookingWhere = windowWhere?.booking as
    | Prisma.BookingWhereInput
    | undefined;

  // why: the `select` does not narrow the result type through the extended
  // client's `Pick`, so the row shape is declared here; it matches the select
  // below field for field. Edit both together.
  return (await client.bookingAsset.findMany({
    where: {
      assetKitId,
      OR: [
        { booking: { ...windowBookingWhere, organizationId } },
        stillOutOnOverdueKitSlice({
          currentBookingId: bookingId,
          organizationId,
        }),
      ],
    },
    select: {
      assetKitId: true,
      checkedOutAt: true,
      checkedInAt: true,
      booking: { select: { id: true, status: true } },
    },
  })) as unknown as KitSliceRow[];
}

/**
 * Groups slices under the kit their membership belongs to and lets
 * `hasKitBookingConflicts` decide each kit. Judged per kit: one kit's
 * reservation must not make another kit conflict.
 */
function judgeKitHolds({
  memberships,
  slices,
  bookingId,
  ignoreReservedConflicts = false,
}: {
  memberships: Membership[];
  slices: KitSliceRow[];
  bookingId: string;
  ignoreReservedConflicts?: boolean;
}): ConflictingKit[] {
  const kitByMembershipId = new Map(
    memberships.map((m) => [m.id, { id: m.kitId, name: m.kit.name }])
  );

  const slicesByKitId = new Map<string, KitBookingSlice[]>();
  for (const slice of slices) {
    const kit = slice.assetKitId
      ? kitByMembershipId.get(slice.assetKitId)
      : undefined;
    if (!kit) continue;
    const group = slicesByKitId.get(kit.id) ?? [];
    group.push(slice);
    slicesByKitId.set(kit.id, group);
  }

  const conflicting: ConflictingKit[] = [];
  const named = new Set<string>();
  for (const { id, name } of kitByMembershipId.values()) {
    if (named.has(id)) continue;
    named.add(id);
    const kitSlices = slicesByKitId.get(id) ?? [];
    if (
      hasKitBookingConflicts(kitSlices, bookingId, { ignoreReservedConflicts })
    ) {
      conflicting.push({ id, name });
    }
  }
  return conflicting;
}
