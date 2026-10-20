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
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

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
