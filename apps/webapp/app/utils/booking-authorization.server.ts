import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "./error";

interface AssertBookingProcessAccessParams {
  booking: {
    custodianUserId: string | null;
  };
  userId: string;
  role: OrganizationRoles;
  /** Used in the error message: "check out" | "check in". */
  action: "check out" | "check in";
}

/**
 * THE authorization answer to "may this user process (check out / check in)
 * this booking?" — every check-out/check-in mutation path must call this
 * (web overview intents, progressive scanner actions, fulfil-and-checkout,
 * mobile endpoints). Booking STATUS eligibility is deliberately not decided
 * here; the service layer owns state-transition guards.
 *
 * Rules:
 * - ADMIN / OWNER: any booking in the organization.
 * - SELF_SERVICE: only bookings they are the custodian of.
 * - BASE: never (the permission matrix denies checkout/checkin as well —
 *   this is defense in depth for surfaces gated on other actions).
 *
 * @throws {ShelfError} 403 when the caller may not process this booking
 */
export function assertBookingProcessAccess({
  booking,
  userId,
  role,
  action,
}: AssertBookingProcessAccessParams): void {
  if (role === OrganizationRoles.BASE) {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message: `You are not authorized to ${action} this booking.`,
      status: 403,
      shouldBeCaptured: false,
    });
  }

  if (
    role === OrganizationRoles.SELF_SERVICE &&
    booking.custodianUserId !== userId
  ) {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message: `You are not authorized to ${action} this booking.`,
      status: 403,
      shouldBeCaptured: false,
    });
  }

  // ADMIN and OWNER are implicitly allowed - no check needed
}

interface AssertBookingVisibilityParams {
  booking: {
    custodianUserId: string | null;
  };
  userId: string;
  /** The flag requirePermission derives from role + org overrides. */
  canSeeAllBookings: boolean;
}

/**
 * Mirror of the booking overview loader's visibility rule, shared so sibling
 * surfaces (activity tab, activity CSV, note actions) enforce the SAME gate:
 * users without see-all rights may only reach bookings they are custodian of.
 *
 * @throws {ShelfError} 403 when the caller may not view this booking
 */
export function assertBookingVisibility({
  booking,
  userId,
  canSeeAllBookings,
}: AssertBookingVisibilityParams): void {
  if (!canSeeAllBookings && booking.custodianUserId !== userId) {
    throw new ShelfError({
      cause: null,
      label: "Booking",
      message: "You are not authorized to view this booking",
      status: 403,
      shouldBeCaptured: false,
    });
  }
}

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
