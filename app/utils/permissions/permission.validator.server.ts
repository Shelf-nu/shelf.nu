import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";

import {
  Role2PermissionMap,
  type PermissionAction,
  type PermissionEntity,
} from "./permission.data";
import { ShelfError } from "../error";

export interface PermissionCheckProps {
  organizationId: string;
  roles?: OrganizationRoles[];
  userId: string;
  action: PermissionAction;
  entity: PermissionEntity;
}

export async function hasPermission(
  params: PermissionCheckProps
): Promise<Boolean> {
  let { userId, entity, action, organizationId, roles } = params;

  try {
    if (!roles || !Array.isArray(roles)) {
      const userOrg = await db.userOrganization.findFirst({
        where: { userId, organizationId },
      });

      if (!userOrg) {
        throw new ShelfError({
          cause: null,
          message: `User doesn't belong to organization`,
          status: 403,
          additionalData: { userId, organizationId },
          label: "Permission",
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
      const entityPermMap = Role2PermissionMap[role];

      if (!entityPermMap) {
        return false;
      }

      const permissions = entityPermMap[entity];

      return permissions.includes(action);
    });

    return validRoles.length > 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Error while checking permission",
      additionalData: { ...params },
      label: "Permission",
    });
  }
}

export const validatePermission = async (props: PermissionCheckProps) => {
  const res = await hasPermission(props);

  if (!res) {
    throw new ShelfError({
      cause: null,
      title: "Unauthorized",
      message: `You have no permission to perform this action`,
      additionalData: { ...props },
      status: 403,
      label: "Permission",
      shouldBeCaptured: false,
    });
  }
  return true;
};
