/**
 * Which bulk actions the current user may take on the booking being viewed.
 *
 * @see {@link file://../components/booking/list-bulk-actions-dropdown.tsx}
 * @see {@link file://../components/booking/list-asset-content.tsx}
 */
import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import { canRoleRemoveBookingAssets } from "~/utils/bookings";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { useBookingStatusHelpers } from "./use-booking-status";
import { useUserRoleHelper } from "./user-user-role-helper";

/**
 * Which bulk actions the current user may take on the booking being viewed.
 *
 * One question per action, because the three do not share a rule: check in and
 * check out are flat permissions, while removal depends on role AND booking
 * status. The column-level `canSeeActions` in `booking-assets-column.tsx`
 * cannot stand in for any of them — it asks only whether the user is the
 * booking's custodian, which a BASE custodian is at every status while holding
 * neither `booking:checkin` nor `booking:checkout` at any of them.
 *
 * Shared by the bulk actions menu, which renders the items, and the row
 * checkbox that selects things for them: a checkbox that can only ever feed an
 * empty menu is dead UI.
 *
 * Cosmetic, like every client-side gate. The route action and the mobile
 * remove endpoint enforce the same rules server-side.
 */
export function useBookingBulkActions() {
  const { booking } = useLoaderData<BookingPageLoaderData>();
  const { roles } = useUserRoleHelper();
  const bookingStatus = useBookingStatusHelpers(
    booking.status as BookingStatus
  );

  const canCheckin = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkin,
  });
  const canCheckout = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkout,
  });
  const canRemove = canRoleRemoveBookingAssets({ roles, booking });

  // Partial check-in applies only to ONGOING/OVERDUE bookings.
  const showPartialCheckin = Boolean(
    canCheckin && (bookingStatus?.isOngoing || bookingStatus?.isOverdue)
  );

  // Partial check-out applies to RESERVED/ONGOING/OVERDUE. Unlike check-in,
  // check-out can START from a RESERVED booking.
  const showPartialCheckout = Boolean(
    canCheckout &&
      (bookingStatus?.isReserved ||
        bookingStatus?.isOngoing ||
        bookingStatus?.isOverdue)
  );

  // Finished = COMPLETE/ARCHIVED. Computed directly from status: the helper's
  // `isFinished` flag isn't present on its undefined-status return shape, and a
  // direct compare matches how the rest of the booking UI checks status.
  const isFinished =
    booking.status === BookingStatus.COMPLETE ||
    booking.status === BookingStatus.ARCHIVED;

  /**
   * Removal stays VISIBLE when status alone is what blocks it, so the menu can
   * explain itself with the existing disabled reason. It disappears when the
   * role may not remove here at all, where a status reason would misstate why.
   *
   * The fallback probes DRAFT rather than trusting `isFinished` on its own:
   * every role that removes at all removes in DRAFT, so this asks "is status
   * the only thing in the way". Without it, a session whose roles have not
   * resolved would still be offered the row on a finished booking.
   */
  const canRemoveAtAnyStatus = canRoleRemoveBookingAssets({
    roles,
    booking: { status: BookingStatus.DRAFT },
  });
  const showRemove = canRemove || (isFinished && canRemoveAtAnyStatus);

  return {
    canRemove,
    showPartialCheckin,
    showPartialCheckout,
    showRemove,
    /** False when the menu would render empty, so nothing should feed it. */
    hasAny: showPartialCheckin || showPartialCheckout || showRemove,
  };
}
