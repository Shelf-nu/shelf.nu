import type { SsoDetails } from "@prisma/client";
import { OrganizationRoles, Roles } from "@prisma/client";
import { db } from "~/database/db.server";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { ShelfError } from "./error";
import type {
  PermissionAction,
  PermissionEntity,
} from "./permissions/permission.data";
import { validatePermission } from "./permissions/permission.validator.server";

export async function requireUserWithPermission(name: Roles, userId: string) {
  try {
    return await db.user.findFirstOrThrow({
      where: { id: userId, roles: { some: { name } } },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "You do not have permission to access this resource",
      additionalData: { userId, name },
      label: "Permission",
      status: 403,
    });
  }
}

export async function requireAdmin(userId: string) {
  return requireUserWithPermission(Roles["ADMIN"], userId);
}

export async function isAdmin(context: Record<string, any>) {
  const authSession = context.getSession();

  const user = await db.user.findFirst({
    where: {
      id: authSession.userId,
      roles: { some: { name: Roles["ADMIN"] } },
    },
  });

  return !!user;
}

export async function requirePermission({
  userId,
  request,
  entity,
  action,
}: {
  userId: string;
  request: Request;
  entity: PermissionEntity;
  action: PermissionAction;
}) {
  /**
   * This can be very slow and consuming as there are a few queries with a few joins and this running on every loader/action makes it slow
   * We need to find a  strategy to make it more performant. Idea:
   * 1. Have a very light weight query that fetches the lastUpdated in relation to userOrganizationRoles. THis can be done both for roles and organizations
   * 2. Store it in a cookie
   * 3. If they mismatch, make the big query to check the actual data
   */

  const {
    organizationId,
    userOrganizations,
    organizations,
    currentOrganization,
  } = await getSelectedOrganisation({ userId, request });

  const roles = userOrganizations.find(
    (o) => o.organization.id === organizationId
  )?.roles;

  await validatePermission({
    roles,
    action,
    entity,
    organizationId,
    userId,
  });

  const role = roles ? roles[0] : OrganizationRoles.BASE;

  return {
    organizations,
    organizationId,
    currentOrganization,
    role,
    isSelfServiceOrBase:
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE,
    userOrganizations,
  };
}

/** Gets the role needed for SSO login from the groupID returned by the SSO claims */
export function getRoleFromGroupId(
  ssoDetails: SsoDetails,
  groupIds: string[]
): OrganizationRoles {
  // We prioritize the admin group. If for some reason the user is in both groups, they will be an admin
  if (ssoDetails.adminGroupId && groupIds.includes(ssoDetails.adminGroupId)) {
    return OrganizationRoles.ADMIN;
  } else if (
    ssoDetails.selfServiceGroupId &&
    groupIds.includes(ssoDetails.selfServiceGroupId)
  ) {
    return OrganizationRoles.SELF_SERVICE;
  } else if (
    ssoDetails.baseUserGroupId &&
    groupIds.includes(ssoDetails.baseUserGroupId)
  ) {
    return OrganizationRoles.BASE;
  } else {
    throw new ShelfError({
      cause: null,
      title: "Group ID not found",
      message:
        "The group your user is assigned to is not connected to shelf. Please contact an administrator for more information",
      label: "Auth",
      additionalData: { ssoDetails, groupIds },
    });
  }
}
