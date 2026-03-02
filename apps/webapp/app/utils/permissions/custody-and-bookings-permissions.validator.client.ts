import type { Organization } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { PermissionAction, PermissionEntity } from "./permission.data";
import { userHasPermission } from "./permission.validator.client";

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
 * Checks if a user has permission to view custody information in general,
 * based on their roles and organization settings.
 *
 * Use this function for UI elements like showing/hiding custody filters.
 *
 * @returns boolean indicating if the user has permission to view custody in general
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
  // First check if the user has the standard permission
  const hasStandardPermission = userHasPermission({
    roles,
    entity: PermissionEntity.custody,
    action: PermissionAction.read,
  });

  if (hasStandardPermission) {
    return true;
  }

  // If user doesn't have standard permission, check for organization overrides
  if (!roles || !roles.length) return false;

  // Check if the user is SELF_SERVICE and has the custody override
  if (
    roles.includes(OrganizationRoles.SELF_SERVICE) &&
    organization.selfServiceCanSeeCustody
  ) {
    return true;
  }

  // Check if the user is BASE and has the custody override
  if (
    roles.includes(OrganizationRoles.BASE) &&
    organization.baseUserCanSeeCustody
  ) {
    return true;
  }

  return false;
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
