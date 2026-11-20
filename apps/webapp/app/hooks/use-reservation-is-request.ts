/**
 * useReservationIsRequest, whether this member's reservations are requests.
 *
 * A member without `booking:checkout` cannot hand items over themself, so a
 * reservation they make waits for staff: the booking form says "Request
 * reservation", a reserved booking's badge says "subject to review", and the
 * process sidebar explains the steps. Read from the permission matrix over
 * every role the membership holds. False until the roles load.
 *
 * @see {@link file://../components/booking/booking-status-badge.tsx}
 */
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import { roleReservesAsRequest } from "~/utils/bookings";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { useBookingSettings } from "./use-booking-settings";
import { useRoleAccess } from "./use-role-access";

/**
 * @returns `true` when this member's reservations are requests for review
 */
export function useReservationIsRequest(): boolean {
  const roles = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.currentOrganizationUserRoles;

  return (
    Boolean(roles?.length) &&
    !userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkout,
    })
  );
}

/**
 * Whether this member's Reserve should be worded as a request: their
 * reservations always wait for staff (see {@link useReservationIsRequest}), or
 * the workspace's approval switch for their role makes them a request. Every
 * place that names the reserve action reads this, so the booking form and
 * the new-booking hint never disagree.
 *
 * @returns `true` when the member's reservation will be a request
 */
export function useReservationWordedAsRequest(): boolean {
  const waitsForStaff = useReservationIsRequest();
  const roleAccess = useRoleAccess();
  const bookingSettings = useBookingSettings();
  return (
    waitsForStaff ||
    roleReservesAsRequest({
      approvalSetting: roleAccess.policy.bookings.approvalSetting,
      settings: bookingSettings,
    })
  );
}
