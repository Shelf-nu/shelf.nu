import { OrganizationRoles } from "@prisma/client";
import {
  Role2PermissionMap,
  type PermissionAction,
  type PermissionEntity,
} from "./permission.data";

type UserHasPermissionArgs = {
  /** Role of the user for which we have to check for permission */
  roles: OrganizationRoles[] | undefined;

  /** Entity for which we have to check for permission */
  entity: PermissionEntity;

  /**
   * The  actions which we have to check. It can be a string of type PermissionAction or an array.
   * If an array is provided, then any single permission match will return `true`
   */
  action: PermissionAction | PermissionAction[];
};

export function userHasPermission({
  roles,
  action,
  entity,
}: UserHasPermissionArgs) {
  if (!roles || !roles.length) return false;

  if (
    roles.includes(OrganizationRoles.ADMIN) ||
    roles.includes(OrganizationRoles.OWNER)
  ) {
    //owner and admin can do anything for now
    return true;
  }

  const actionsToCheck = typeof action === "string" ? [action] : action;

  const validRoles = roles.filter((role) => {
    const entityPermMap = Role2PermissionMap[role];

    if (!entityPermMap) {
      return false;
    }

    const permissions = entityPermMap[entity];

    return permissions.some((permission) =>
      actionsToCheck.includes(permission)
    );
  });

  return validRoles.length > 0;
}
