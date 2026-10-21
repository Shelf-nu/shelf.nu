import type { Organization, OrganizationRoles } from "@prisma/client";
import { isOrganizationRole, resolveRoleAccess } from "./role-access";

/**
 * Type for organization permission settings
 */
export type OrganizationPermissionSettings = Pick<
  Organization, // Replace 'any' with your Organization type if available
  | "selfServiceCanSeeCustody"
  | "selfServiceCanSeeBookings"
  | "baseUserCanSeeCustody"
  | "baseUserCanSeeBookings"
>;

type UserCustodyViewPermissionsArgs = {
  /** Role of the user for which we have to check for permission */
  roles: OrganizationRoles[] | undefined;

  /** Organization with permission override settings */
  organization: OrganizationPermissionSettings;

  /** Current user ID */
  currentUserId?: string;

  /** Custody information - can be null if no custody exists */
  custodianUserId?: string | null;
};

/**
 * Whether the member may see custody held by other people: the client twin
 * of `access.custody.seeAll`, resolved by the same resolver so the UI and the
 * server agree for every membership, including mixed ones (the highest role
 * decides).
 *
 * A membership with no known role sees nothing: during loading the layout
 * data has no roles yet, and custody must stay hidden until it does.
 *
 * Use it for UI such as custody filters and custody columns.
 *
 * @param args.roles - The member's roles in the current workspace
 * @param args.organization - The workspace's custody visibility toggles
 * @returns `true` when custody of other people may be shown
 */
export function userHasCustodyViewPermission({
  roles,
  organization,
}: {
  roles: OrganizationRoles[] | undefined;
  organization: Pick<
    Organization,
    "selfServiceCanSeeCustody" | "baseUserCanSeeCustody"
  >;
}): boolean {
  if (!roles?.some(isOrganizationRole)) return false;
  return resolveRoleAccess({
    roles,
    workspace: {
      selfServiceCanSeeCustody: organization.selfServiceCanSeeCustody,
      baseUserCanSeeCustody: organization.baseUserCanSeeCustody,
      // Booking visibility does not affect custody visibility.
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
    },
  }).custody.seeAll;
}

/**
 * Checks if a user has permission to view a specific custody record,
 * taking into account if they are the custodian.
 *
 * Use this function when checking if a user can see a specific custody record.
 *
 * @returns boolean indicating if the user has permission to view the specific custody
 */
export function userCanViewSpecificCustody({
  roles,
  organization,
  currentUserId,
  custodianUserId,
}: UserCustodyViewPermissionsArgs): boolean {
  // If the current user is the custodian, they can always see it
  if (currentUserId && custodianUserId && currentUserId === custodianUserId) {
    return true;
  }

  // Otherwise, check general custody view permission
  return userHasCustodyViewPermission({ roles, organization });
}
