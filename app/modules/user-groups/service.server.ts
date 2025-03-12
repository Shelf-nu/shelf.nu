import type { Group } from "@prisma/client";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";

const label = "User Group";

export async function createNewGroup({
  name,
  organizationId,
  createdById,
}: Pick<Group, "name" | "organizationId" | "createdById">) {
  try {
    return await db.group.create({
      data: {
        name,
        organization: { connect: { id: organizationId } },
        createdBy: { connect: { id: createdById } },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while creating group.",
      label,
    });
  }
}
