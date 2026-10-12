/**
 * Role access for the companion: how far the signed-in member reaches in the
 * current workspace, resolved by `@shelf/permissions` exactly as the server
 * resolves it (`resolveRoleAccess`: the membership's highest-rank role folded
 * with the workspace's visibility toggles).
 *
 * Cosmetic only: it decides which affordances to show. Every mobile endpoint
 * enforces the same rules on the server. Not a mirror: it calls the shared
 * package, so web, mobile API and companion cannot drift.
 *
 * Pure (no React Native / Expo imports) so `node --test` can load it.
 *
 * @see {@link file://../../../packages/permissions/src/access.ts}
 * @see {@link file://../hooks/use-role-access.ts}
 */
import type { BookingStatusName, RoleAccess } from "@shelf/permissions";
import {
  BOOKING_STATUS_NAMES,
  canManageBookingItems,
  canRemoveBookingItems,
  resolveRoleAccess,
  roleHasPermission,
} from "@shelf/permissions";

import type { Organization } from "./api/types";

/** The organization fields access is resolved from. */
export type OrganizationAccessFields = Pick<Organization, "roles"> &
  Partial<
    Pick<
      Organization,
      | "selfServiceCanSeeBookings"
      | "baseUserCanSeeBookings"
      | "selfServiceCanSeeCustody"
      | "baseUserCanSeeCustody"
    >
  >;

/**
 * Resolves the member's access in an organization.
 *
 * @param org - The current organization from `/api/mobile/me`; `null` while loading
 * @returns The member's access. With `org` missing it is BASE access with every
 *   toggle off, so gates stay closed until the real answer arrives; a toggle
 *   the server did not send reads as off.
 */
export function accessForOrganization(
  org: OrganizationAccessFields | null | undefined
): RoleAccess {
  return resolveRoleAccess({
    roles: org?.roles ?? [],
    workspace: {
      selfServiceCanSeeBookings: org?.selfServiceCanSeeBookings === true,
      baseUserCanSeeBookings: org?.baseUserCanSeeBookings === true,
      selfServiceCanSeeCustody: org?.selfServiceCanSeeCustody === true,
      baseUserCanSeeCustody: org?.baseUserCanSeeCustody === true,
    },
  });
}

/**
 * Narrows a status string from the API to a status this build knows.
 *
 * @param status - The booking status as the API sent it
 * @returns The status, or `null` when this build does not know it
 */
function knownStatus(status: string): BookingStatusName | null {
  return (BOOKING_STATUS_NAMES as readonly string[]).includes(status)
    ? (status as BookingStatusName)
    : null;
}

/**
 * Whether the membership holds `booking:update`, which every add or remove
 * requires on the server.
 *
 * The status rules alone are not enough: an empty, still-loading or unknown
 * role set resolves to BASE access (whose DRAFT rules allow item changes), but
 * holds no permission. This half is what keeps those gates closed, as the
 * server does.
 *
 * @param roles - Every role on the membership, as `/api/mobile/me` sent them
 * @returns `true` when the membership may update bookings
 */
function mayUpdateBookings(roles: readonly string[] | undefined): boolean {
  return roleHasPermission({ roles, entity: "booking", action: "update" });
}

/**
 * Whether items may be added to a booking in this status (scan-to-add, browse,
 * model reservations, fulfil). Unknown statuses and memberships without
 * `booking:update` deny.
 *
 * @param access - The member's access
 * @param status - The booking status as the API sent it
 * @param roles - Every role on the membership (`currentOrg.roles`)
 * @returns `true` when the member may add items
 */
export function canAddItemsToBooking(
  access: RoleAccess,
  status: string,
  roles: readonly string[] | undefined
): boolean {
  const bookingStatus = knownStatus(status);
  return (
    bookingStatus !== null &&
    mayUpdateBookings(roles) &&
    canManageBookingItems({ access, bookingStatus })
  );
}

/**
 * Whether items may be removed from a booking in this status. Unknown
 * statuses and memberships without `booking:update` deny.
 *
 * @param access - The member's access
 * @param status - The booking status as the API sent it
 * @param roles - Every role on the membership (`currentOrg.roles`)
 * @returns `true` when the member may remove items
 */
export function canRemoveItemsFromBooking(
  access: RoleAccess,
  status: string,
  roles: readonly string[] | undefined
): boolean {
  const bookingStatus = knownStatus(status);
  return (
    bookingStatus !== null &&
    mayUpdateBookings(roles) &&
    canRemoveBookingItems({ access, bookingStatus })
  );
}

/**
 * Whether the server's ownership check accepts this member adding items to a
 * booking (scan or browse to add, model requests, fulfil).
 *
 * A role whose booking writes are scoped (`!access.bookings.writeAll`) may
 * add only to bookings whose direct custodian user it is: the mobile add and
 * model-request endpoints key on that link, not the creator. Removal accepts
 * the team member link too; see `mayRemoveBookingItemsAsCustodian`. Seeing
 * every booking (a workspace see-toggle) does not widen this.
 *
 * @param args.access - The member's access
 * @param args.userId - The signed-in user; missing while loading
 * @param args.custodianUserId - The booking's custodian user, if any
 * @returns `true` when the member may change this booking's items
 */
export function mayWriteBookingItems({
  access,
  userId,
  custodianUserId,
}: {
  access: RoleAccess;
  userId: string | undefined;
  custodianUserId: string | undefined;
}): boolean {
  if (access.bookings.writeAll) return true;
  return !!userId && custodianUserId === userId;
}

/**
 * Whether the server's ownership check accepts this member removing items from
 * a booking.
 *
 * The remove endpoint is looser than add: a scoped role (`!writeAll`) passes
 * when it is the custodian through EITHER link, the booking's direct custodian
 * user or the custodian team member's user. A booking assigned before its
 * custodian accepted their invite keeps only the team member link.
 *
 * @param args.access - The member's access
 * @param args.userId - The signed-in user; missing while loading
 * @param args.custodianUserId - The booking's direct custodian user, if any
 * @param args.custodianTeamMemberUserId - The custodian team member's user, if any
 * @returns `true` when the member may remove items from this booking
 */
export function mayRemoveBookingItemsAsCustodian({
  access,
  userId,
  custodianUserId,
  custodianTeamMemberUserId,
}: {
  access: RoleAccess;
  userId: string | undefined;
  custodianUserId: string | undefined;
  custodianTeamMemberUserId: string | null | undefined;
}): boolean {
  if (access.bookings.writeAll) return true;
  if (!userId) return false;
  return custodianUserId === userId || custodianTeamMemberUserId === userId;
}

/**
 * Whether the member may release an asset's current custody.
 *
 * A member whose custody reach is "self" may take custody only for themselves
 * and release only their own; the release endpoint refuses anyone else's. Any
 * other custody reach releases whoever holds it.
 *
 * @param args.access - The member's access
 * @param args.userId - The signed-in user; missing while loading
 * @param args.custodianUserId - The custodian's user; null for a non-registered member
 * @returns `true` when the release would be accepted for this custodian
 */
export function mayReleaseAssetCustody({
  access,
  userId,
  custodianUserId,
}: {
  access: RoleAccess;
  userId: string | undefined;
  custodianUserId: string | null | undefined;
}): boolean {
  if (access.custody.assign !== "self") return true;
  return !!userId && custodianUserId === userId;
}
