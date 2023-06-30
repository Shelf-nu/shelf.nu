import { json } from "@remix-run/node";
import { db } from "~/database";

export async function requireUserWithPermission(
  name: string,
  request: Request
) {
  const userId = await requireUserId(request);

  const user = await db.user.findFirst({
    where: { id: userId, roles: { some: { name } } },
  });

  if (!user) {
    throw json({ error: "Unauthorized", requiredRole: name }, { status: 403 });
  }
  return user;
}

export async function requireAdmin(request: Request) {
  return requireUserWithPermission("admin", request);
}

export async function requireDealer(request: Request) {
  return requireUserWithPermission("dealer", request);
}
