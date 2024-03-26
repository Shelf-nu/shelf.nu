import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";

import { ShelfError } from "../error";

export enum PermissionAction {
  create = "create",
  read = "read",
  update = "update",
  delete = "delete",
  checkout = "checkout",
  checkin = "checkin",
  export = "export",
  import = "import",
}
export enum PermissionEntity {
  asset = "asset",
  qr = "qr",
  booking = "booking",
  tag = "tag",
  category = "category",
  location = "location",
  customField = "customField",
  workspace = "workspace",
  teamMember = "teamMember",
  dashboard = "dashboard",
  generalSettings = "generalSettings",
  subscription = "subscription",
}

export interface PermissionCheckProps {
  organizationId: string;
  roles?: OrganizationRoles[];
  userId: string;
  action: PermissionAction;
  entity: PermissionEntity;
}

//this will come from DB eventually
const Role2PermissionMap: {
  [K in OrganizationRoles]?: Record<PermissionEntity, PermissionAction[]>;
} = {
  [OrganizationRoles.SELF_SERVICE]: {
    [PermissionEntity.asset]: [PermissionAction.read],
    [PermissionEntity.booking]: [
      PermissionAction.create,
      PermissionAction.read,
      PermissionAction.update,
      PermissionAction.delete, // This is for the user to delete their own bookings only when they are draft.
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

async function hasPermission(params: PermissionCheckProps): Promise<Boolean> {
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
    });
  }
};
