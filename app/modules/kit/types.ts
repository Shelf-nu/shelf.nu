import type { Kit } from "@prisma/client";

export type UpdateKitPayload = Partial<
  Pick<Kit, "name" | "description" | "status" | "image" | "imageExpiration" | "createdById">
> & {
  id: Kit["id"];
};
