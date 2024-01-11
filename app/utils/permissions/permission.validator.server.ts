import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database";
import type { PermissionCheckProps } from "./types";
import { PermissionAction, PermissionEntity } from "./types";
import { ShelfStackError } from "../error";

//this will come from DB eventually
const Role2PermisionMap: {
  [K in OrganizationRoles]?: Record<PermissionEntity, PermissionAction[]>;
} = {
  [OrganizationRoles.SELF_SERVICE]: {
    [PermissionEntity.asset]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
    ],
    [PermissionEntity.qr]: [],
    [PermissionEntity.category]: [],
    [PermissionEntity.customField]: [],
    [PermissionEntity.location]: [],
    [PermissionEntity.tag]: [],
    [PermissionEntity.teamMember]: [],
    [PermissionEntity.workspace]: [],
    [PermissionEntity.dashboard]: [],
    [PermissionEntity.generalSettings]: [],
    [PermissionEntity.subscription]: [],
  },
};

export const hasPermission = async ({
  userId,
  entity,
  action,
  organizationId,
  roles,
}: PermissionCheckProps): Promise<Boolean> => {
  if (!roles || !Array.isArray(roles)) {
    const userOrg = await db.userOrganization.findFirst({
      where: { userId, organizationId },
    });
    if (!userOrg) {
      throw new ShelfStackError({
        message: `User doesn't belong to organization`,
        status: 403,
        metadata: { userId, organizationId },
      });
    }
    roles = userOrg.roles;
  }
  if (
    roles.includes(OrganizationRoles.ADMIN) ||
    roles.includes(OrganizationRoles.OWNER)
  ) {
    //owner and admin can do anything for now
    return true;
  }

  const validRoles = roles.filter((role) => {
    const entityPermMap = Role2PermisionMap[role];
    if (!entityPermMap) return false;
    const permissions = entityPermMap[entity];
    return permissions.includes(action);
  });
  return validRoles.length > 0;
};

export const validatePermission = async (props: PermissionCheckProps) => {
  const res = await hasPermission(props);
  if (!res) {
    throw new ShelfStackError({
      title: "Unauthorized",
      // message: `You are not authorised to ${props.action} the ${props.entity}`,
      message: `You are not authorised to access this view.`,
      status: 403,
    });
  }
};
