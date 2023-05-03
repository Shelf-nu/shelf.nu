import type { Qr } from "@prisma/client";

export const belongsToUser = (qr: Qr) => qr.userId !== null;
