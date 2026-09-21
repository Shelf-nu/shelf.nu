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
 *   stay booked for a later scan or select. Kits are refused on this path.
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
import { BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  addScannedAssetsToBooking,
  fulfilModelRequestsAndCheckout,
  partialCheckoutBooking,
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
 *   nothing would go out, a kit is scanned on the scanned-only path, or the
 *   booking cannot be checked out in its current status
 */
export async function fulfilAndCheckOut({
  requireExplicitCheckout,
  ...args
}: FulfilAndCheckOutArgs): Promise<FulfilAndCheckOutResult> {
  // Under the requirement the flow is known up front, so the scan is judged
  // before anything is read. Without it the booking's status decides.
  let status: BookingStatus | undefined;
  if (!requireExplicitCheckout) {
    status = await readBookingStatus(args);
    if (status === BookingStatus.RESERVED) {
      const booking = await fulfilModelRequestsAndCheckout(args);
      return {
        booking: { id: booking.id, name: booking.name, status: booking.status },
        remainingAssetCount: 0,
      };
    }
  }

  return checkOutScannedUnits(args, status);
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
 * @param knownStatus - The booking's status, when the caller already read it
 * @returns The booking's id, name and status, and how many assets remain
 * @throws {ShelfError} 404 when the booking is not in the workspace; 400 when
 *   nothing was scanned, a kit was scanned, or the booking cannot be checked
 *   out in its current status
 */
async function checkOutScannedUnits(
  args: Omit<FulfilAndCheckOutArgs, "requireExplicitCheckout">,
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

  // This path checks out scanned asset ids only, so a scanned kit would be
  // counted but stay booked. Refused before anything is assigned; "Scan to
  // check out" expands a kit into its members.
  if (kitIds.length > 0) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message:
        "Kits can't be checked out from the reservation scanner. Use Scan to check out for kits.",
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
  const alreadyAssigned = await db.bookingAsset.findMany({
    where: {
      bookingId,
      booking: { organizationId },
      assetId: { in: assetIds },
      assetKitId: null,
    },
    select: { assetId: true },
  });
  const alreadyAssignedIds = new Set(alreadyAssigned.map((row) => row.assetId));
  const assetIdsToAssign = assetIds.filter((id) => !alreadyAssignedIds.has(id));

  if (assetIdsToAssign.length > 0) {
    await addScannedAssetsToBooking({
      assetIds: assetIdsToAssign,
      bookingId,
      organizationId,
      userId,
    });
  }

  const result = await partialCheckoutBooking({
    id: bookingId,
    organizationId,
    assetIds,
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
