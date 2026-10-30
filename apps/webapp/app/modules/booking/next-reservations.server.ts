/**
 * What a running booking's items are promised to next.
 *
 * Read by the booking page loader for ONGOING and OVERDUE bookings. It feeds
 * two surfaces from one query:
 *
 * - the extend horizon, the first RESERVED booking after this one's end that
 *   holds an item still out, shown in the Change end date dialog as "free
 *   until", so people pick a later end knowing where the boundary is;
 * - the next reservation of each item still out, shown on its row in the
 *   item list, so the people planning returns see which items are spoken
 *   for and from when.
 *
 * Same clash rule as the extend guard (`findClashingReservations`), with no
 * upper bound on the window.
 *
 * @see {@link file://./clash-reservations.server.ts}
 * @see {@link file://../../routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { AssetType } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  findClashingReservations,
  resolveHeldKits,
} from "./clash-reservations.server";
import {
  redactClashingBookings,
  type ClashingBooking,
} from "./clashing-bookings";
import {
  getAssetsStillOutForExtend,
  getKitMembershipIdsStillOut,
  isExtendableStatus,
} from "./extend-eligibility";

/** The booking an item is promised to next, and from when (ISO). */
export type NextReservation = {
  /** `null` when the reader may not see other members' bookings. */
  bookingId: string | null;
  bookingName: string;
  from: string;
};

/**
 * The first reservation standing after this booking's end. `freeUntil` is
 * its start; `blockedBy` names it and the items it needs.
 */
export type ExtendHorizon = {
  freeUntil: string;
  blockedBy: ClashingBooking;
};

/** What the loader hands the page. Empty maps when nothing is promised. */
export type NextReservations = {
  horizon: ExtendHorizon | null;
  byAssetId: Record<string, NextReservation>;
  byKitId: Record<string, NextReservation>;
};

const NONE: NextReservations = { horizon: null, byAssetId: {}, byKitId: {} };

/**
 * Load the next reservations of a booking's items still out.
 *
 * @param organizationId - The workspace the booking belongs to
 * @param bookingId - The booking whose items are measured
 * @param revealOtherBookings - Whether the reader may see other members'
 * bookings; otherwise the bookings are reported without name or link
 * @returns The horizon and per-item next reservations; all empty for a
 * booking that is not running, or whose items are all back
 */
export async function loadNextReservations({
  organizationId,
  bookingId,
  revealOtherBookings,
}: {
  organizationId: string;
  bookingId: string;
  revealOtherBookings: boolean;
}): Promise<NextReservations> {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: {
      status: true,
      to: true,
      bookingAssets: {
        select: {
          assetId: true,
          assetKitId: true,
          checkedOutAt: true,
          checkedInAt: true,
          asset: { select: { id: true, status: true, type: true } },
        },
      },
      partialCheckins: { select: { assetIds: true } },
    },
  });
  if (!booking || !isExtendableStatus(booking.status)) return NONE;

  // Only assets held by name. A quantity-tracked asset is a pool shared by
  // many bookings at once, so another booking's units are not a claim on
  // these; the extend guard measures that pool separately.
  const activeAssetIds = getAssetsStillOutForExtend(
    booking.bookingAssets.map((ba) => ba.asset),
    booking.partialCheckins.flatMap((c) => c.assetIds)
  )
    .filter((a) => a.type !== AssetType.QUANTITY_TRACKED)
    .map((a) => a.id);
  const heldKits = await resolveHeldKits({
    client: db,
    organizationId,
    membershipIdsStillOut: getKitMembershipIdsStillOut(booking.bookingAssets),
  });

  const clashes = redactClashingBookings(
    await findClashingReservations({
      client: db,
      organizationId,
      bookingId,
      activeAssetIds,
      heldKits,
      after: booking.to,
    }),
    revealOtherBookings
  );
  if (clashes.length === 0) return NONE;

  const byAssetId: Record<string, NextReservation> = {};
  const byKitId: Record<string, NextReservation> = {};
  // Clashes come earliest first, so the first time an item is seen is its
  // next reservation.
  for (const clash of clashes) {
    const next = {
      bookingId: clash.id,
      bookingName: clash.name,
      from: clash.from,
    };
    for (const item of clash.items) {
      const target = item.kind === "kit" ? byKitId : byAssetId;
      target[item.id] ??= next;
    }
  }

  return {
    horizon: { freeUntil: clashes[0].from, blockedBy: clashes[0] },
    byAssetId,
    byKitId,
  };
}
