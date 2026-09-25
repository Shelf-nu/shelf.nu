import type { Booking, Currency } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "./badge-colors";
import { formatCurrency } from "./currency";
import { canRemoveBookingItems } from "./permissions/role-access";
import type { BookingStatusName, RoleAccess } from "./permissions/role-access";
import type { UserNameFields } from "./user";
import { resolveTeamMemberName } from "./user";

/**
 * The statuses a booking is still open to item removal in: every status that
 * is not a closed record (COMPLETE, ARCHIVED, CANCELLED).
 */
const REMOVABLE_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Whether items may still be REMOVED from a booking in its current status.
 *
 * Removal stays open until the booking is finished: a booking that is
 * COMPLETE, ARCHIVED or CANCELLED is a closed record and its contents must not
 * change.
 *
 * Status-only: every remove path needs it, including services with no caller
 * in scope. Surfaces acting for a user add the caller's policy through
 * `canRemoveBookingItems` / `mayRemoveBookingItems`.
 *
 * Ownership remains the caller's to enforce either way.
 *
 * @param booking - The booking being modified; only `status` is consulted
 * @returns `true` when the booking is still open to item removal
 */
export function canUserRemoveBookingAssets(booking: Pick<Booking, "status">) {
  return REMOVABLE_STATUSES.includes(booking.status);
}

/**
 * Whether items may be added through the booking SCAN page in this status.
 *
 * The scan page keeps its own rule, `bookings.scanAddAfterDraft`, which is
 * wider than the manage-items rule for BASE. Closed bookings refuse everyone.
 *
 * @param args.access - The caller's access
 * @param args.bookingStatus - The booking's status
 * @returns `true` when the scan page may add items
 */
export function canScanAddBookingItems({
  access,
  bookingStatus,
}: {
  access: RoleAccess;
  bookingStatus: BookingStatusName;
}): boolean {
  if (!REMOVABLE_STATUSES.includes(bookingStatus)) {
    return false;
  }
  return (
    access.policy.bookings.scanAddAfterDraft ||
    bookingStatus === BookingStatus.DRAFT
  );
}

/**
 * Whether a surface should offer removing items from a booking in this status.
 *
 * Every remove path is gated on `booking:update`, which BASE holds, so the
 * matrix grant alone does not settle it: the status half comes from the
 * caller's policy (`canRemoveBookingItems`). The grant is passed in rather than
 * derived here so this stays pure; callers compute it with `userHasPermission`,
 * which denies while the session's roles are still loading.
 *
 * Ownership is still the caller's to enforce.
 *
 * @param args.canUpdateBooking - The caller holds `booking:update`
 * @param args.access - The caller's access
 * @param args.bookingStatus - The booking's status
 * @returns `true` when removal may be offered
 */
export function mayRemoveBookingItems({
  canUpdateBooking,
  access,
  bookingStatus,
}: {
  canUpdateBooking: boolean;
  access: RoleAccess;
  bookingStatus: BookingStatusName;
}): boolean {
  return canUpdateBooking && canRemoveBookingItems({ access, bookingStatus });
}

/**
 * Whether the booking custodian is fixed to the caller themself: the booking
 * form's custodian picker, its seed, and the server guards on create and edit.
 *
 * @param access - The caller's access
 * @returns `true` when the caller may only book for themself
 */
export function bookingCustodianIsSelf(access: RoleAccess): boolean {
  return access.policy.bookings.custodianPicker === "self";
}

export const bookingStatusColorMap: {
  [key in BookingStatus]: BadgeColorScheme;
} = {
  DRAFT: BADGE_COLORS.gray,
  RESERVED: BADGE_COLORS.blue,
  ONGOING: BADGE_COLORS.violet,
  OVERDUE: BADGE_COLORS.red,
  COMPLETE: BADGE_COLORS.green,
  ARCHIVED: BADGE_COLORS.gray,
  CANCELLED: BADGE_COLORS.gray,
};

/**
 * Calculates the total value of booked items in a booking.
 *
 * The multiplier is **`bookedQuantity`** — the units the booking actually
 * reserved (from `BookingAsset.quantity`), NOT `Asset.quantity` (total
 * workspace stock). For a QT asset stocked at 100 with 5 booked, the
 * contribution is `valuation × 5`, not `valuation × 100`. Booking a
 * single asset across multiple slices (standalone + kit, or two kits)
 * naturally sums correctly: each slice contributes its own bookedQuantity.
 *
 * Callers always project from `booking.bookingAssets`. Do not pass
 * spread asset rows — they carry stock quantity and would overcharge.
 *
 * @param assets - Per-slice projection: `{ valuation, bookedQuantity }`.
 * @param currency - Workspace currency.
 * @param locale - UI locale for number formatting.
 * @returns Formatted total (e.g. `"$300.00"`).
 */
/** Resolve custodian display name from booking data */
export function getBookingCustodianName(booking: {
  custodianTeamMember?: { name: string } | null;
  custodianUser?: UserNameFields | null;
}): string | null {
  if (booking.custodianTeamMember) {
    return resolveTeamMemberName({
      name: booking.custodianTeamMember.name,
    });
  }
  if (booking.custodianUser) {
    return resolveTeamMemberName({
      name: "",
      user: booking.custodianUser,
    });
  }
  return null;
}

export function calculateTotalValueOfAssets({
  assets,
  currency,
  locale,
}: {
  assets: {
    /** Per-unit price (`Asset.valuation`). May be null when not set. */
    valuation: number | null;
    /**
     * Booked units for this slice (`BookingAsset.quantity`). INDIVIDUAL
     * assets always have `1`. Defaults to `1` defensively if missing so a
     * malformed input never explodes; callers should always supply it.
     */
    bookedQuantity: number | null;
  }[];
  currency: Currency;
  locale: string;
}): string {
  // Multiplies per-unit `valuation` by `bookedQuantity` — the units the
  // booking actually reserved. Asset stock quantity is irrelevant to a
  // booking total; using it would overcharge for QT assets where the
  // booking holds only a slice of the pool. See JSDoc above.
  const value = assets.reduce(
    (acc, { valuation, bookedQuantity }) =>
      acc + (valuation ?? 0) * (bookedQuantity ?? 1),
    0
  );
  return formatCurrency({
    value: value,
    locale,
    currency,
  });
}
