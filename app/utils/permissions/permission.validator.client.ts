import { OrganizationRoles } from "@prisma/client";
import {
  Role2PermissionMap,
  type PermissionAction,
  type PermissionEntity,
} from "./permission.data";

export function userHasPermission({
  roles,
  action,
  entity,
}: {
  roles: OrganizationRoles[] | undefined;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  if (!roles || !roles.length) return false;

  if (
    roles.includes(OrganizationRoles.ADMIN) ||
    roles.includes(OrganizationRoles.OWNER)
  ) {
    //owner and admin can do anything for now
    return true;
  }

  const validRoles = roles.filter((role) => {
    const entityPermMap = Role2PermissionMap[role];

    if (!entityPermMap) {
      return false;
    }

    const permissions = entityPermMap[entity];

    return permissions.includes(action);
  });

  return validRoles.length > 0;
}
