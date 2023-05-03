import type { Qr, User } from "@prisma/client";

export const belongsToCurrentUser = (qr: Qr, userId: User["id"]) =>
  qr.userId === userId;
