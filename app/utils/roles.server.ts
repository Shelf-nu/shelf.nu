import { Roles } from "@prisma/client";
import { json } from "@remix-run/node";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";

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
