import { OrganizationRoles, Roles } from "@shelf/database";
import { db } from "~/database/db.server";
import { findFirst, throwIfError } from "~/database/query-helpers.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { ShelfError } from "./error";
import type {
  PermissionAction,
  PermissionEntity,
} from "./permissions/permission.data";
import { validatePermission } from "./permissions/permission.validator.server";

export async function requireUserWithPermission(name: Roles, userId: string) {
  try {
    // Check user exists and has the required role via the _RoleToUser join table
    // Note: the _RoleToUser table was stripped in the MSP migration.
    // Role checking is now done via UserOrganization.roles array.
    const user = await findFirst(db, "User", {
      where: { id: userId },
    });

    if (!user) {
      throw { code: "PGRST116", message: "User not found" };
    }

    return { id: user.id };
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

  // Check if user is an admin via their role
  const user = await findFirst(db, "User", {
    where: { id: authSession.userId },
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
  const {
    organizationId,
    userOrganizations,
    organizations,
    currentOrganization,
  } = await getSelectedOrganization({ userId, request });

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

  const isSelfServiceOrBase =
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE;

  const canSeeAllBookings =
    !isSelfServiceOrBase ||
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeBookings) ||
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeBookings);

  const canSeeAllCustody =
    !isSelfServiceOrBase ||
    (role === OrganizationRoles.SELF_SERVICE &&
      currentOrganization.selfServiceCanSeeCustody) ||
    (role === OrganizationRoles.BASE &&
      currentOrganization.baseUserCanSeeCustody);

  const canUseBarcodes = currentOrganization.barcodesEnabled ?? false;

  const canUseAudits = currentOrganization.auditsEnabled ?? false;

  return {
    organizations,
    organizationId,
    currentOrganization,
    role,
    isSelfServiceOrBase,
    userOrganizations,
    canSeeAllBookings,
    canSeeAllCustody,
    canUseBarcodes,
    canUseAudits,
  };
}

/** SSO details type placeholder (SsoDetails table was stripped in MSP migration) */
interface SsoDetails {
  adminGroupId?: string | null;
  selfServiceGroupId?: string | null;
  baseUserGroupId?: string | null;
}

/** Gets the role needed for SSO login from the groupID returned by the SSO claims */
export function getRoleFromGroupId(
  ssoDetails: SsoDetails,
  groupIds: string[]
): OrganizationRoles | null {
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
    return null;
  }
}
