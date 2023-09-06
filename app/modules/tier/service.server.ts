import type { User } from "@prisma/client";
import { db } from "~/database";
import {
  canCreateMoreCustomFields,
  canExportAssets,
  canImportAssets,
} from "~/utils/subscription";
export async function getUserTierLimit(id: User["id"]) {
  try {
    const { tier } = await db.user.findUniqueOrThrow({
      where: { id },
      select: {
        tier: {
          include: { tierLimit: true },
        },
      },
    });

    return tier?.tierLimit;
  } catch (cause) {
    throw new Error("Something went wrong while fetching user tier limit");
  }
}

export async function assertUserCanImportAssets({
  userId,
}: {
  userId: User["id"];
}) {
  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      tier: {
        include: { tierLimit: true },
      },
      organizations: {
        select: {
          id: true,
          type: true,
        },
      },
    },
  });

  if (!canImportAssets(user?.tier?.tierLimit)) {
    throw new Error("Your user cannot import assets");
  }
  return { user };
}

export async function assertUserCanExportAssets({
  userId,
}: {
  userId: User["id"];
}) {
  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);

  if (!canExportAssets(tierLimit)) {
    throw new Error("Your user cannot export assets");
  }
}

export const assertUserCanCreateMoreCustomFields = async ({
  userId,
}: {
  userId: User["id"];
}) => {
  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);
  const canCreateMore = canCreateMoreCustomFields({
    tierLimit,
    totalCustomFields: await db.customField.count({
      where: { userId },
    }),
  });

  if (!canCreateMore) {
    throw new Error("Your user cannot create more custom fields");
  }
};
