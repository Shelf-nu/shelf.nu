import type { Organization } from "@prisma/client";
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

/**
 * Type for custody information
 */
type CustodyInfo = {
  custodian?: {
    user?: {
      id?: string;
    } | null;
  } | null;
};

type UserCustodyViewPermissionsArgs = {
  /** Role of the user for which we have to check for permission */
  roles: OrganizationRoles[] | undefined;

  /** Organization with permission override settings */
  organization: OrganizationPermissionSettings;

  /** Current user ID */
  currentUserId?: string;

  /** Custody information - can be null if no custody exists */
  custody?: CustodyInfo | null;
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
  custody,
}: UserCustodyViewPermissionsArgs): boolean {
  // If there's no custody, we can return based on standard permissions only
  if (!custody) {
    return userHasPermission({
      roles,
      entity: PermissionEntity.custody,
      action: PermissionAction.read,
    });
  }

  // Check if the current user is the custodian
  if (currentUserId && custody.custodian?.user?.id === currentUserId) {
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

// type UserBookingViewPermissionsArgs = {
//   /** Role of the user for which we have to check for permission */
//   roles: OrganizationRoles[] | undefined;

//   /** Organization with permission override settings */
//   organization: OrganizationWithPermissionSettings;
// };

// /**
//  * Checks if a user has permission to view booking information based on their roles
//  * and organization-specific settings.
//  *
//  * @returns boolean indicating if the user has permission to view bookings
//  */
// export function userHasBookingViewPermission({
//   roles,
//   organization,
// }: UserBookingViewPermissionsArgs): boolean {
//   // First check if the user has the standard permission
//   const hasStandardPermission = userHasPermission({
//     roles,
//     entity: PermissionEntity.booking,
//     action: PermissionAction.read,
//   });

//   if (hasStandardPermission) {
//     return true;
//   }

//   // If user doesn't have standard permission, check for organization overrides
//   if (!roles || !roles.length) return false;

//   // Check if the user is SELF_SERVICE and has the booking override
//   if (
//     roles.includes(OrganizationRoles.SELF_SERVICE) &&
//     organization.selfServiceCanSeeBookings
//   ) {
//     return true;
//   }

//   // Check if the user is BASE and has the booking override
//   if (
//     roles.includes(OrganizationRoles.BASE) &&
//     organization.baseUserCanSeeBookings
//   ) {
//     return true;
//   }

//   return false;
// }
