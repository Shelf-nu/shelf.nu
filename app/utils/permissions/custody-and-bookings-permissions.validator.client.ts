import type { Organization, User } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { PermissionAction, PermissionEntity } from "./permission.data";
import { userHasPermission } from "./permission.validator.client";

/**
 * Type for organization permission settings
 */
type OrganizationPermissionSettings = Pick<
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
  custodianUser?: Pick<User, "id"> | null;
};

/**
 * Checks if a user has permission to view custody information based on their roles,
 * organization-specific settings, and whether they are the custodian.
 *
 * @returns boolean indicating if the user has permission to view custody
 */
export function userHasCustodyViewPermission({
  roles,
  organization,
  currentUserId,
  custodianUser,
}: UserCustodyViewPermissionsArgs): boolean {
  // If there's no custody, we can return based on standard permissions only
  if (!custodianUser) {
    return userHasPermission({
      roles,
      entity: PermissionEntity.custody,
      action: PermissionAction.read,
    });
  }

  // Check if the current user is the custodian
  if (currentUserId && custodianUser?.id === currentUserId) {
    return true;
  }

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
