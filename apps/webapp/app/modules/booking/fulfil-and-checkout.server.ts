/**
 * Fulfil-and-check-out
 *
 * The entry point the web fulfil scanner and the mobile fulfil endpoint call.
 * It chooses the flow by the workspace's explicit check-out requirement:
 *
 * - Not required: {@link fulfilModelRequestsAndCheckout} assigns the scanned
 *   units to the booking's model reservations and checks the whole booking out
 *   in one transaction.
 * - Required: only what the operator scanned leaves. The units are assigned
 *   with {@link addScannedAssetsToBooking}, the scan-to-add path, which
 *   discharges matching reservations. Then only the scanned ids are checked
 *   out with {@link partialCheckoutBooking}. The booking's other assets stay
 *   booked for a later scan or select. Kits are refused on this path.
 *
 * The required flow runs two transactions. If the check-out step fails, the
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
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
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
 * Shape of a `BookingModelRequest` row this module reads to decide whether a
 * check-out can proceed. Pinned explicitly (rather than left to inference) so
 * `assetModel` survives into {@link getOutstandingModelRequests}'s generic
 * even if the extended Prisma client's inferred payload type ever widens —
 * mirrors `checkoutBookingWritesWithinTx`'s `GuardModelRequest`.
 */
type GuardModelRequest = {
  quantity: number;
  fulfilledQuantity: number;
  fulfilledAt: Date | null;
  assetModel: { name: string };
};

/**
 * Assigns the scanned units to the booking's model reservations and checks out
 * either the whole booking or, under the explicit check-out requirement, only
 * the scanned units.
 *
 * @param args - The scan, the booking, the caller, and whether the rule applies
 * @returns The booking's id, name and status, and how many assets remain
 * @throws {ShelfError} 404 when the booking is not in the workspace; 400 when a
 *   kit is scanned under the requirement, the booking cannot be checked out,
 *   or a reservation is still unassigned after the scan
 */
export async function fulfilAndCheckOut({
  requireExplicitCheckout,
  ...args
}: FulfilAndCheckOutArgs): Promise<FulfilAndCheckOutResult> {
  if (!requireExplicitCheckout) {
    const booking = await fulfilModelRequestsAndCheckout(args);
    return {
      booking: { id: booking.id, name: booking.name, status: booking.status },
      remainingAssetCount: 0,
    };
  }

  const { bookingId, organizationId, userId, assetIds, kitIds = [] } = args;

  // This path checks out scanned asset ids only, so a scanned kit would be
  // counted but stay booked. Refused before anything is read or assigned;
  // "Scan to check out" expands a kit into its members.
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
  // Checked before anything is assigned, so a booking that cannot be checked
  // out is left exactly as it was.
  if (!CHECKOUT_STATUSES.includes(booking.status)) {
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

  // A booking does not go out while a reservation is unassigned. The scanned
  // units stay assigned, so the operator scans only what is still reserved.
  const requests: GuardModelRequest[] = await db.bookingModelRequest.findMany({
    where: { bookingId, booking: { organizationId } },
    select: {
      quantity: true,
      fulfilledQuantity: true,
      fulfilledAt: true,
      assetModel: { select: { name: true } },
    },
  });
  const outstanding = getOutstandingModelRequests<GuardModelRequest>(requests);
  if (outstanding.length > 0) {
    const summary = outstanding
      .map((r) => `${r.quantity - r.fulfilledQuantity} × ${r.assetModel.name}`)
      .join(", ");
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: `Cannot check out — ${summary} still unassigned. The scanned units were assigned; scan the remaining reserved units to check out.`,
      shouldBeCaptured: false,
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
