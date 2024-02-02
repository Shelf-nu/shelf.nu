import { Roles } from "@prisma/client";
import { json } from "@remix-run/node";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import type { PermissionAction, PermissionEntity } from "./permissions";
import { validatePermission } from "./permissions";

export async function requireUserWithPermission(name: Roles, request: Request) {
  const { userId } = await requireAuthSession(request);

  const user = await db.user.findFirst({
    where: { id: userId, roles: { some: { name } } },
  });

  if (!user) {
    throw json({ error: "Unauthorized", requiredRole: name }, { status: 403 });
  }
  return user;
}

export async function requireAdmin(request: Request) {
  return requireUserWithPermission(Roles["ADMIN"], request);
}

export async function requireDealer(request: Request) {
  return requireUserWithPermission(Roles["USER"], request);
}

export async function isAdmin(request: Request) {
  const { userId } = await requireAuthSession(request);

  const user = await db.user.findFirst({
    where: { id: userId, roles: { some: { name: Roles["ADMIN"] } } },
  });

  return !!user;
}

export async function requirePermision(
  request: Request,
  entity: PermissionEntity,
  action: PermissionAction
) {
  const authSession = await requireAuthSession(request);
  const {
    organizationId,
    userOrganizations,
    organizations,
    currentOrganization,
  } = await requireOrganisationId(authSession, request);

  const roles = userOrganizations.find(
    (o) => o.organization.id === organizationId
  )?.roles;

  await validatePermission({
    roles,
    action,
    entity,
    organizationId,
    userId: authSession.userId,
  });

  return {
    authSession,
    organizations,
    organizationId,
    currentOrganization,
    role: roles ? roles[0] : undefined,
  };
}
