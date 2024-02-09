import { Roles } from "@prisma/client";
import { json } from "@remix-run/node";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import type { PermissionAction, PermissionEntity } from "./permissions";
import { validatePermission } from "./permissions";

export async function requireUserWithPermission(name: Roles, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, roles: { some: { name } } },
  });

  if (!user) {
    throw json({ error: "Unauthorized", requiredRole: name }, { status: 403 });
  }
  return user;
}

export async function requireAdmin(userId: string) {
  return requireUserWithPermission(Roles["ADMIN"], userId);
}

export async function isAdmin(request: Request) {
  const { userId } = await requireAuthSession(request);

  const user = await db.user.findFirst({
    where: { id: userId, roles: { some: { name: Roles["ADMIN"] } } },
  });

  return !!user;
}

export async function requirePermision({
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
  } = await requireOrganisationId({ userId, request });

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

  return {
    organizations,
    organizationId,
    currentOrganization,
    role: roles ? roles[0] : undefined,
  };
}
