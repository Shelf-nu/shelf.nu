/**
 * The version of a reservation request an approver approves.
 *
 * Approval says "yes" to what the approver saw: the booking's own fields and
 * everything it holds. Many writes change what a booking holds without
 * touching the booking row (kit edits propagate slices, quantities move, model
 * reservations change), so `Booking.updatedAt` alone cannot tell a changed
 * request from the one reviewed. This version folds the booking's
 * `updatedAt` together with every slice and every model reservation, so any
 * change to the request changes it, whichever write made the change.
 *
 * The approve form sends the version it rendered; `approveBooking` reads it
 * again under the booking row lock and refuses when they differ.
 *
 * @see {@link file://./service.server.ts} `approveBooking`
 */
import { createHash } from "node:crypto";
import { BookingStatus } from "@prisma/client";
import type { Booking, Organization } from "@prisma/client";
import type { db } from "~/database/db.server";

/** A client that can read a booking: `db` or a transaction. */
type BookingReader = Pick<typeof db, "booking">;

/**
 * Reads the request version of a booking, or `null` when it is not in the
 * workspace.
 *
 * @param client - `db`, or the transaction holding the booking row lock
 * @param args.bookingId - The booking
 * @param args.organizationId - Its workspace
 * @param args.pendingOnly - Read only a pending request; see the field
 * @returns A hex digest that changes whenever the booking or its contents do
 */
export async function readBookingRequestVersion(
  client: BookingReader,
  {
    bookingId,
    organizationId,
    pendingOnly = false,
  }: {
    bookingId: Booking["id"];
    organizationId: Organization["id"];
    /**
     * Read only a reservation request still waiting for a decision (RESERVED,
     * never approved), and `null` for anything else without loading its
     * contents. For page loads, where most bookings are not pending.
     */
    pendingOnly?: boolean;
  }
): Promise<string | null> {
  const booking = await client.booking.findFirst({
    where: {
      id: bookingId,
      organizationId,
      ...(pendingOnly
        ? { status: BookingStatus.RESERVED, approvedAt: null }
        : {}),
    },
    select: {
      updatedAt: true,
      bookingAssets: {
        select: { id: true, assetId: true, assetKitId: true, quantity: true },
        orderBy: { id: "asc" },
      },
      modelRequests: {
        select: { assetModelId: true, quantity: true },
        orderBy: { assetModelId: "asc" },
      },
    },
  });
  if (!booking) return null;
  return hashRequest(booking);
}

/**
 * The digest itself, over a fixed order so the same contents always give the
 * same version.
 *
 * @param request - The booking's `updatedAt`, slices and model reservations
 * @returns A hex digest
 */
export function hashRequest(request: {
  updatedAt: Date;
  bookingAssets: Array<{
    id: string;
    assetId: string;
    assetKitId: string | null;
    quantity: number;
  }>;
  modelRequests: Array<{ assetModelId: string; quantity: number }>;
}): string {
  const canonical = JSON.stringify({
    updatedAt: request.updatedAt.toISOString(),
    slices: [...request.bookingAssets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => [s.id, s.assetId, s.assetKitId, s.quantity]),
    models: [...request.modelRequests]
      .sort((a, b) => a.assetModelId.localeCompare(b.assetModelId))
      .map((m) => [m.assetModelId, m.quantity]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
