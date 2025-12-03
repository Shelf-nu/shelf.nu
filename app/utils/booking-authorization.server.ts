import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "./error";

interface ValidateBookingOwnershipParams {
  booking: {
    creatorId: string | null;
    custodianUserId: string | null;
  };
  userId: string;
  role: OrganizationRoles;
  action: string;
  /**
   * When true, only checks custodianUserId (not creatorId).
   * Used for operations like PDF/calendar download where only the custodian should have access.
   * @default false
   */
  checkCustodianOnly?: boolean;
  /**
   * When true, BASE users are blocked entirely (used for destructive actions like extend/delete).
   * When false, BASE users are checked for ownership like SELF_SERVICE (used for read operations).
   * @default false
   */
  blockBaseEntirely?: boolean;
}

/**
 * Validates that a user has permission to perform an action on a booking based on their role and ownership.
 *
 * Authorization rules:
 * - BASE users: Blocked for write operations, ownership-checked for read operations
 * - SELF_SERVICE users: Only allowed on bookings they own (creator OR custodian)
 * - ADMIN/OWNER users: Allowed on all bookings
 *
 * @throws {ShelfError} 403 if user is not authorized
 */
export function validateBookingOwnership({
  booking,
  userId,
  role,
  action,
  checkCustodianOnly = false,
  blockBaseEntirely = false,
}: ValidateBookingOwnershipParams): void {
  if (role === OrganizationRoles.BASE && blockBaseEntirely) {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message: `You are not authorized to ${action} this booking.`,
      status: 403,
      shouldBeCaptured: false,
    });
  }

  if (
    role === OrganizationRoles.SELF_SERVICE ||
    role === OrganizationRoles.BASE
  ) {
    const isBookingOwner = checkCustodianOnly
      ? booking.custodianUserId === userId
      : booking.creatorId === userId || booking.custodianUserId === userId;

    if (!isBookingOwner) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        message: `You are not authorized to ${action} this booking.`,
        status: 403,
        shouldBeCaptured: false,
      });
    }
  }

  // ADMIN and OWNER roles are implicitly allowed - no check needed
}
