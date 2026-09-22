/**
 * Fulfil-and-check-out
 *
 * The entry point the web fulfil scanner and the mobile fulfil endpoint call.
 * It chooses the flow by the booking's status and the workspace's explicit
 * check-out requirement:
 *
 * - A RESERVED booking, requirement off: {@link fulfilModelRequestsAndCheckout}
 *   assigns the scanned units to the booking's model reservations and checks
 *   the whole booking out in one transaction.
 * - Otherwise only what the operator scanned leaves: under the requirement,
 *   and on a booking whose items have already started leaving, where sending
 *   the whole booking out again would re-stamp items that are out or back. The
 *   units are assigned with {@link addScannedAssetsToBooking}, the scan-to-add
 *   path, which discharges matching reservations. Then only the scanned ids are
 *   checked out with {@link partialCheckoutBooking}. The booking's other assets
 *   stay booked for a later scan or select.
 *
 * A scanned kit is handled the same way on either flow: its memberships are
 * resolved server-side, the ones not yet on the booking are added, and every
 * member leaves with it. INDIVIDUAL members answer matching model
 * reservations, because a unit inside a kit is the same unit as a loose one.
 *
 * Either way a check-out needs at least one item to go out, and nothing more:
 * reserved units no scan covered stay open on the ongoing booking, to be
 * scanned later or released. On the scanned-only path that item has to be a
 * scanned one; the requirement exists so a person handles every item that
 * leaves.
 *
 * The scanned-only flow runs two transactions. If the check-out step fails, the
 * units stay assigned but not out, the state Manage assets leaves, and the
 * operator finishes with "Scan to check out" or submits the same scan again:
 * units already on the booking are not assigned twice.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../booking-settings/explicit-checkout.ts}
 */
import { AssetType, BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  addScannedAssetsToBooking,
  buildKitSlicesForBooking,
  computeBookingAssetSliceRemainingToCheckOut,
  fulfilModelRequestsAndCheckout,
  partialCheckoutBooking,
} from "~/modules/booking/service.server";
import type {
  CheckoutDispositionInput,
  KitSliceSpec,
} from "~/modules/booking/service.server";
import { ShelfError } from "~/utils/error";

const label = "Booking";

/** Statuses a booking can have items checked out in. */
const CHECKOUT_STATUSES: BookingStatus[] = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Arguments for {@link fulfilAndCheckOut}.
 *
 * `from`/`to` apply only to the full check-out; under the explicit check-out
 * requirement the booking's own persisted window is used.
 */
export type FulfilAndCheckOutArgs = Parameters<
  typeof fulfilModelRequestsAndCheckout
>[0] & {
  /** True when the workspace requires explicit check-out for the caller's role. */
  requireExplicitCheckout: boolean;
};

/** What the routes need back from a fulfil-and-check-out. */
export type FulfilAndCheckOutResult = {
  booking: { id: string; name: string; status: BookingStatus };
  /** Assets on the booking still to check out; 0 after a full check-out. */
  remainingAssetCount: number;
};

/**
 * Assigns the scanned units to the booking's model reservations and checks
 * them out: the whole booking when it is RESERVED and the explicit check-out
 * requirement is off, only the scanned units otherwise.
 *
 * @param args - The scan, the booking, the caller, and whether the rule applies
 * @returns The booking's id, name and status, and how many assets remain
 * @throws {ShelfError} 404 when the booking is not in the workspace; 400 when
 *   nothing would go out, or the booking cannot be checked out in its current
 *   status
 */
export async function fulfilAndCheckOut({
  requireExplicitCheckout,
  ...args
}: FulfilAndCheckOutArgs): Promise<FulfilAndCheckOutResult> {
  // Callers send the kit ids their operator scanned; the memberships behind
  // them are resolved here rather than trusted from the client, so every
  // surface — web drawer, mobile endpoint, companion — books a kit the same
  // org-scoped way. See `.claude/rules/kit-members-via-kit-slices.md`.
  const scannedKits = await resolveScannedKits(args);

  // Under the requirement the flow is known up front, so the scan is judged
  // before anything is read. Without it the booking's status decides.
  let status: BookingStatus | undefined;
  if (!requireExplicitCheckout) {
    status = await readBookingStatus(args);
    if (status === BookingStatus.RESERVED) {
      const booking = await fulfilModelRequestsAndCheckout({
        ...args,
        assetIds: scannedKits.looseAssetIds,
        kitSlices: scannedKits.newSlices,
      });
      return {
        booking: { id: booking.id, name: booking.name, status: booking.status },
        remainingAssetCount: 0,
      };
    }
  }

  return checkOutScannedUnits(args, scannedKits, status);
}

/** A scanned kit's memberships, split by what this booking already holds. */
type ScannedKits = {
  /**
   * Memberships not yet on the booking. These become new kit-driven
   * `BookingAsset` rows, and their INDIVIDUAL members discharge matching
   * model reservations.
   */
  newSlices: KitSliceSpec[];
  /**
   * Every `AssetKit` id the scan named, including memberships this booking
   * already holds — scanning a kit already on the booking is exactly how an
   * operator sends it out, so those rows still have to leave.
   *
   * It is the discriminator on the kit-driven `BookingAsset` rows, and so the
   * way to find the rows this scan is responsible for once they exist.
   */
  assetKitIds: string[];
  /**
   * The scanned assets that are NOT members of a scanned kit — the ones to
   * add as standalone rows.
   *
   * An operator who scans a camera and then the case it lives in has named
   * one physical unit twice. The two partial unique indexes let a standalone
   * row and a kit-driven row coexist, so inserting both books the unit twice
   * and every count on the booking doubles. The kit slice owns the member,
   * matching the same-call precedence in `updateBookingAssets` and the
   * scan-to-assign route.
   */
  looseAssetIds: string[];
};

/**
 * Resolves the scanned kit ids into their `AssetKit` memberships.
 *
 * @param args - The booking, the caller's workspace and the scanned kit ids
 * @returns The memberships to add, and every member asset to check out
 * @throws {ShelfError} If the membership lookup fails
 */
async function resolveScannedKits({
  bookingId,
  organizationId,
  kitIds = [],
  assetIds,
}: Pick<
  FulfilAndCheckOutArgs,
  "bookingId" | "organizationId" | "kitIds" | "assetIds"
>): Promise<ScannedKits> {
  if (kitIds.length === 0) {
    return { newSlices: [], assetKitIds: [], looseAssetIds: assetIds };
  }

  // Unfiltered, so one read serves every half: the memberships already on the
  // booking are the ones to skip when adding and to keep when checking out,
  // and every member is a candidate to drop from the loose bucket.
  const allSlices = await buildKitSlicesForBooking({ kitIds, organizationId });

  const bookedAssetKitRows = await db.bookingAsset.findMany({
    where: { bookingId, assetKitId: { not: null } },
    select: { assetKitId: true },
  });
  const bookedAssetKitIds = new Set(
    bookedAssetKitRows.map((row) => row.assetKitId)
  );

  const memberAssetIds = [...new Set(allSlices.map((slice) => slice.assetId))];
  const memberAssetIdSet = new Set(memberAssetIds);

  return {
    newSlices: allSlices.filter(
      (slice) => !bookedAssetKitIds.has(slice.assetKitId)
    ),
    assetKitIds: allSlices.map((slice) => slice.assetKitId),
    looseAssetIds: assetIds.filter((id) => !memberAssetIdSet.has(id)),
  };
}

/**
 * Reads the booking's status, scoped to the caller's workspace.
 *
 * @param args - The booking id and the caller's workspace
 * @returns The booking's status
 * @throws {ShelfError} 404 when the booking is not in the workspace
 */
async function readBookingStatus({
  bookingId,
  organizationId,
}: Pick<FulfilAndCheckOutArgs, "bookingId" | "organizationId">) {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { status: true },
  });
  if (!booking) {
    throw new ShelfError({
      cause: null,
      status: 404,
      label,
      message: "Booking not found in this workspace.",
      shouldBeCaptured: false,
    });
  }
  return booking.status;
}

/**
 * Assigns the scanned units, then checks out only those.
 *
 * @param args - The scan, the booking and the caller
 * @param scannedKits - The scanned kits' memberships, already resolved
 * @param knownStatus - The booking's status, when the caller already read it
 * @returns The booking's id, name and status, and how many assets remain
 * @throws {ShelfError} 404 when the booking is not in the workspace; 400 when
 *   nothing was scanned, or the booking cannot be checked out in its current
 *   status
 */
async function checkOutScannedUnits(
  args: Omit<FulfilAndCheckOutArgs, "requireExplicitCheckout">,
  scannedKits: ScannedKits,
  knownStatus?: BookingStatus
): Promise<FulfilAndCheckOutResult> {
  const { bookingId, organizationId, userId, assetIds, kitIds = [] } = args;

  // Only scanned items leave on this path, so an empty scan has nothing to
  // check out. Refused before anything is assigned.
  if (assetIds.length === 0 && kitIds.length === 0) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: "Scan at least one item to check out.",
      shouldBeCaptured: false,
    });
  }

  const status = knownStatus ?? (await readBookingStatus(args));
  // Checked before anything is assigned, so a booking that cannot be checked
  // out is left exactly as it was.
  if (!CHECKOUT_STATUSES.includes(status)) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message:
        "This booking can't be checked out in its current status. Only reserved, ongoing, or overdue bookings can have items checked out.",
      shouldBeCaptured: false,
    });
  }

  // A refused check-out leaves the scanned units assigned, and the booking
  // allows one standalone row per asset, so a retry of the same scan assigns
  // only the units not already on the booking. The check-out below still
  // takes every scanned id.
  const alreadyOnBooking = await db.bookingAsset.findMany({
    where: {
      bookingId,
      booking: { organizationId },
      assetId: { in: scannedKits.looseAssetIds },
    },
    select: {
      assetId: true,
      assetKitId: true,
      asset: { select: { type: true } },
    },
  });

  /**
   * Scans that must not be assigned again, for either of two reasons.
   *
   * A standalone row already holds the unit, whatever its type — assigning it
   * twice would collide with `BookingAsset_manual_unique`.
   *
   * An INDIVIDUAL asset held only through a kit is the subtler one: it has no
   * standalone row, so the unique index does not object, and a loose row would
   * quietly book that one physical unit a second time. This scanner has no
   * blockers by design, so an operator scanning a case and then a camera
   * inside it reaches here freely. The mirror of the rule the scan-to-add path
   * applies to kit slices.
   *
   * QUANTITY_TRACKED is exempt from the second reason: a free-pool slice
   * legitimately coexists with kit slices.
   *
   * Either way the asset still leaves with the booking — it is on it already,
   * through the row it has.
   */
  const alreadyAssignedIds = new Set(
    alreadyOnBooking
      .filter(
        (row) =>
          row.assetKitId === null || row.asset.type === AssetType.INDIVIDUAL
      )
      .map((row) => row.assetId)
  );
  const assetIdsToAssign = scannedKits.looseAssetIds.filter(
    (id) => !alreadyAssignedIds.has(id)
  );

  if (assetIdsToAssign.length > 0 || scannedKits.newSlices.length > 0) {
    await addScannedAssetsToBooking({
      assetIds: assetIdsToAssign,
      kitIds,
      kitSlices: scannedKits.newSlices,
      bookingId,
      organizationId,
      userId,
    });
  }

  /**
   * What a scanned kit sends out, resolved to the rows it owns.
   *
   * A bare asset id claims that asset's WHOLE remaining quantity on the
   * booking, summed across every slice it holds. For an INDIVIDUAL member that
   * is exact — it has one row. For a QUANTITY_TRACKED member it is not: the
   * same asset can sit in this kit, in another kit, and in the free pool at
   * once, so an asset-wide claim sends out units the operator never scanned
   * and stamps `checkedOutAt` on slices that never left.
   *
   * So QT members are named per slice instead, by `bookingAssetId` and the
   * units that slice still owes. Read after the assign above, because a
   * membership added by this very scan has no row before it.
   * @see {@link file://./../../../../../.claude/rules/booking-checkout-is-recorded-per-slice.md}
   */
  const scannedKitRows =
    scannedKits.assetKitIds.length > 0
      ? await db.bookingAsset.findMany({
          where: {
            bookingId,
            booking: { organizationId },
            assetKitId: { in: scannedKits.assetKitIds },
          },
          select: {
            id: true,
            assetId: true,
            checkedInAt: true,
            asset: { select: { type: true } },
          },
        })
      : [];

  const kitSliceCheckouts: CheckoutDispositionInput[] = [];
  const individualKitMemberAssetIds: string[] = [];
  for (const row of scannedKitRows) {
    if (row.asset.type !== AssetType.QUANTITY_TRACKED) {
      // A member already returned on this booking cannot go out again, and
      // naming one refuses the WHOLE check-out — including the loose assets
      // scanned alongside it. A kit holding one returned member and one still
      // to go is ordinary on an ongoing booking, so the row is skipped rather
      // than left to fail the batch.
      if (row.checkedInAt) continue;
      individualKitMemberAssetIds.push(row.assetId);
      continue;
    }
    // Remaining, never booked: a slice already partly out would otherwise
    // over-claim and trip the per-asset cap.
    const sliceRemaining = await computeBookingAssetSliceRemainingToCheckOut(
      db,
      bookingId,
      row.id
    );
    if (sliceRemaining > 0) {
      kitSliceCheckouts.push({
        assetId: row.assetId,
        bookingAssetId: row.id,
        quantity: sliceRemaining,
      });
    }
  }

  /**
   * The scans that may be named asset-wide.
   *
   * Built from `looseAssetIds`, never the raw scan: an asset named both loose
   * and through a scanned kit is already covered above — by its slice if it is
   * quantity-tracked, by `individualKitMemberAssetIds` if it is not. Naming it
   * here as well would add a bare claim on top, and a bare claim takes the
   * asset's whole remaining across every slice it holds, which is the
   * over-checkout the per-slice dispositions exist to avoid.
   *
   * A quantity-tracked asset scanned both ways therefore sends out its kit
   * slice and not its free-pool one. The kit slice owns the member, the same
   * precedence the assign side applies; the free-pool units stay booked for a
   * scan that names them alone.
   *
   * Deduped so an asset reachable twice is checked out once.
   */
  const assetIdsToCheckOut = [
    ...new Set([...scannedKits.looseAssetIds, ...individualKitMemberAssetIds]),
  ];

  const result = await partialCheckoutBooking({
    id: bookingId,
    organizationId,
    assetIds: assetIdsToCheckOut,
    checkouts: kitSliceCheckouts.length > 0 ? kitSliceCheckouts : undefined,
    userId,
    hints: args.hints,
    intentChoice: args.checkoutIntentChoice,
  });

  return {
    booking: {
      id: result.booking.id,
      name: result.booking.name,
      status: result.booking.status,
    },
    remainingAssetCount: result.remainingAssetCount,
  };
}
