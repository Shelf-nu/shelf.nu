import type { Organization, Qr, User } from "@prisma/client";

export const belongsToCurrentUser = (qr: Qr, userId: User["id"]) =>
  qr.userId === userId;

export const belongsToCurrentUsersOrg = (
  qr: Qr,
  orgs?: Organization[]
): boolean => Boolean(orgs?.find(({ id }) => id === qr.organizationId));
