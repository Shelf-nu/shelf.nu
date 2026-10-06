/**
 * Kit holders
 *
 * A kit is one physical unit with one holder at a time: a custodian, or a
 * booking that has it out, never both and never two of either
 * (`.claude/rules/custody-and-bookings-never-overlap.md`). These guards decide
 * it for every path that takes a hold: check-out (booking service) and custody
 * assign (single-kit route and `bulkAssignKitCustody`). Release reads the same
 * "still out on another live booking" answer, so taking a kit and handing it
 * back follow one rule.
 *
 * A leaf module on purpose: it imports no service, so the booking service, the
 * kit service and routes can all use it without importing each other.
 *
 * @see {@link file://./service.server.ts} check-out and release
 * @see {@link file://./../kit/service.server.ts} bulkAssignKitCustody
 */

import { AssetType, BookingStatus, KitStatus, Prisma } from "@prisma/client";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { resolveSliceKitIds } from "./slice-kit-attribution";

const label = "Booking";

/** The models the holder guards read, plus the raw lock. */
type KitHolderClient = Pick<
  ExtendedPrismaClient,
  "kit" | "assetKit" | "bookingAsset" | "$queryRaw"
>;

/**
 * The kits, among `kitIds`, that another ONGOING or OVERDUE booking still has
 * out: one of its slices holding the kit carries `checkedOutAt` and no
 * `checkedInAt`.
 *
 * One answer for both directions. Check-out refuses a kit in this set (its
 * units are physically away), and release keeps one in it CHECKED_OUT, so
 * taking a kit and handing it back are judged by the same rule.
 *
 * @param client Pass the active `tx` when called inside a transaction.
 * @param args.excludeBookingIds The bookings acting on the kit, so their own
 *   slices cannot pin it.
 * @returns Kit ids held by another live booking.
 */
export async function getKitIdsHeldByOtherLiveBookings(
  client: Pick<ExtendedPrismaClient, "assetKit" | "bookingAsset">,
  {
    kitIds,
    organizationId,
    excludeBookingIds,
  }: {
    kitIds: string[];
    organizationId: string;
    excludeBookingIds: string[];
  }
): Promise<Set<string>> {
  if (kitIds.length === 0) return new Set();

  // `sourceKitId` names the kit directly; the `assetKitId` leg needs the pivot
  // ids to compare against, for slices written before that column existed.
  const membershipRows = await client.assetKit.findMany({
    where: { kitId: { in: kitIds }, organizationId },
    select: { id: true, kitId: true },
  });
  const kitIdByAssetKitId = new Map(
    membershipRows.map((row) => [row.id, row.kitId])
  );

  const slicesStillOut = await client.bookingAsset.findMany({
    where: {
      bookingId: { notIn: excludeBookingIds },
      booking: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId,
      },
      // A live booking is not by itself evidence that it holds the kit; only
      // the slice's own markers say that. A partially returned
      // QUANTITY_TRACKED slice keeps a null `checkedInAt` and still counts,
      // which is correct: some of its units are still out.
      checkedOutAt: { not: null },
      checkedInAt: null,
      // The three shapes a slice can hold a kit through: the same three
      // `getKitIdsToAcquire` stamps one from. Drop the last leg and a kit whose
      // INDIVIDUAL member is out on a standalone slice reads as unheld, because
      // that slice carries no provenance by design.
      OR: [
        { sourceKitId: { in: kitIds } },
        { assetKitId: { in: [...kitIdByAssetKitId.keys()] } },
        {
          sourceKitId: null,
          assetKitId: null,
          asset: {
            type: AssetType.INDIVIDUAL,
            assetKits: { some: { kitId: { in: kitIds }, organizationId } },
          },
        },
      ],
    },
    select: {
      id: true,
      assetKitId: true,
      sourceKitId: true,
      asset: {
        select: { type: true, assetKits: { select: { kitId: true } } },
      },
    },
  });

  // Attributed by the shared pure resolver: one implementation of "which kit
  // does this slice hold" keeps acquire and release from drifting apart.
  // `kitIdByAssetKitId` covers every membership of the requested kits, which
  // is every `assetKitId` the read above can match.
  const kitIdsBySliceId = slicesStillOut.map((slice) =>
    resolveSliceKitIds(
      {
        assetKitId: slice.assetKitId,
        sourceKitId: slice.sourceKitId,
        // Defensive `?.` for fixtures and narrower selects, NOT because the
        // fallback is harmless here: a slice that fails to pin its kit makes
        // the kit MORE releasable, which is the direction this guard exists to
        // prevent. The `select` above always projects `asset`, so the fallback
        // is unreachable in production; keep it that way if this query is
        // edited.
        assetKits: slice.asset?.assetKits ?? [],
        assetType: slice.asset?.type,
      },
      kitIdByAssetKitId
    )
  );

  // Intersected with the kits actually being released: a standalone slice's
  // asset can belong to kits this exit knows nothing about, and those are not
  // ours to pin.
  const requestedKitIds = new Set(kitIds);
  const heldByAnotherBooking = new Set<string>();
  for (const sliceKitIds of kitIdsBySliceId) {
    for (const kitId of sliceKitIds) {
      if (requestedKitIds.has(kitId)) heldByAnotherBooking.add(kitId);
    }
  }

  return heldByAnotherBooking;
}

/**
 * Locks the kits' rows for the rest of the transaction, so the holder guards
 * below judge a kit nobody else can change underneath them.
 *
 * Without it the guards are plain reads under READ COMMITTED: two check-outs
 * of one kit by different bookings, or a check-out and a custody assign, can
 * each read the kit as free and both commit. A partial check-out may not write
 * the `Kit` row at all, so no write conflict would catch it either. Every path
 * that takes a hold on a kit goes through a guard here, so all of them queue
 * on the same rows. Sorted by id so concurrent callers lock in one order.
 *
 * @param client Pass the active `tx`; the lock lasts until it commits.
 */
async function lockKitsForHolderCheck(
  client: Pick<ExtendedPrismaClient, "$queryRaw">,
  { kitIds, organizationId }: { kitIds: string[]; organizationId: string }
): Promise<void> {
  const ids = [...new Set(kitIds)].sort();
  if (ids.length === 0) return;
  await client.$queryRaw`
    SELECT id FROM "Kit"
    WHERE id IN (${Prisma.join(ids)}) AND "organizationId" = ${organizationId}
    ORDER BY id
    FOR UPDATE
  `;
}

/**
 * Refuses a check-out that would take a kit somebody else holds.
 *
 * A kit is one physical unit, so it has one holder at a time
 * (`.claude/rules/custody-and-bookings-never-overlap.md`):
 *  - a kit with a `KitCustody` row is with its custodian, whatever its members
 *    are. The asset-level guard cannot see this for a quantity-only kit,
 *    because a `QUANTITY_TRACKED` member's IN_CUSTODY only means some of its
 *    units are held;
 *  - a kit another ONGOING or OVERDUE booking still has out is physically away.
 *
 * Only check-out is gated. Adding a kit in custody to a booking, or reserving
 * it, is fine: the kit is expected back before the booking checks out.
 *
 * Pass the kits this check-out takes, resolved as the stamp resolves them
 * (`getKitIdsToAcquire*`), so a kit is refused exactly when it would be taken.
 *
 * @param client Pass the active `tx`: the kit rows stay locked until it
 *   commits, so the check holds for the write that follows.
 * @param args.bookingId The booking checking out, whose own slices never pin
 *   its kits.
 * @throws {ShelfError} 400 when any kit is in custody or out on another booking
 */
export async function assertKitsCheckoutable(
  client: KitHolderClient,
  {
    kitIds,
    bookingId,
    organizationId,
  }: {
    kitIds: string[];
    bookingId: string;
    organizationId: string;
  }
): Promise<void> {
  if (kitIds.length === 0) return;

  await lockKitsForHolderCheck(client, { kitIds, organizationId });

  const kitsInCustody = await client.kit.findMany({
    where: { id: { in: kitIds }, organizationId, custody: { isNot: null } },
    select: { id: true, name: true },
  });
  if (kitsInCustody.length > 0) {
    throw new ShelfError({
      cause: null,
      label,
      status: 400,
      title: "Kits in custody",
      message: `Cannot check out booking. Some kits are in custody: ${listKitNames(
        kitsInCustody
      )}. Release their custody first or remove them from the booking.`,
      additionalData: { bookingId, kitIds: kitsInCustody.map((k) => k.id) },
      shouldBeCaptured: false,
    });
  }

  const heldElsewhere = await getKitIdsHeldByOtherLiveBookings(client, {
    kitIds,
    organizationId,
    excludeBookingIds: [bookingId],
  });
  if (heldElsewhere.size > 0) {
    const kitsOut = await client.kit.findMany({
      where: { id: { in: [...heldElsewhere] }, organizationId },
      select: { id: true, name: true },
    });
    throw new ShelfError({
      cause: null,
      label,
      status: 400,
      title: "Kits checked out elsewhere",
      message: `Cannot check out booking. Some kits are still checked out on another booking: ${listKitNames(
        kitsOut
      )}. Check them in there first or remove them from this booking.`,
      additionalData: { bookingId, kitIds: [...heldElsewhere] },
      shouldBeCaptured: false,
    });
  }
}

/**
 * Refuses putting a kit in custody while a booking has it out: the reverse of
 * {@link assertKitsCheckoutable}. A kit is one physical unit with one holder.
 *
 * Reads both the kit's status and the booking slices, because `Kit.status`
 * alone can be stale in either direction.
 *
 * @param client Pass the active `tx`: the kit rows stay locked until it
 *   commits, so the check holds for the assign that follows.
 * @throws {ShelfError} 400 when any kit is checked out or out on a live booking
 */
export async function assertKitsCustodyAssignable(
  client: KitHolderClient,
  { kitIds, organizationId }: { kitIds: string[]; organizationId: string }
): Promise<void> {
  if (kitIds.length === 0) return;

  await lockKitsForHolderCheck(client, { kitIds, organizationId });

  const heldByBooking = await getKitIdsHeldByOtherLiveBookings(client, {
    kitIds,
    organizationId,
    excludeBookingIds: [],
  });
  const kitsOut = await client.kit.findMany({
    where: {
      id: { in: kitIds },
      organizationId,
      OR: [
        { status: KitStatus.CHECKED_OUT },
        { id: { in: [...heldByBooking] } },
      ],
    },
    select: { id: true, name: true },
  });
  if (kitsOut.length > 0) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      status: 400,
      title: "Kits checked out",
      message: `Cannot assign custody. Some kits are checked out on a booking: ${listKitNames(
        kitsOut
      )}. Check them in first.`,
      additionalData: { kitIds: kitsOut.map((k) => k.id) },
      shouldBeCaptured: false,
    });
  }
}

/** Up to three kit names, then "and N more", for a refusal message. */
function listKitNames(kits: { name: string }[]): string {
  const shown = kits
    .slice(0, 3)
    .map((kit) => kit.name)
    .join(", ");
  return kits.length > 3 ? `${shown} and ${kits.length - 3} more` : shown;
}
