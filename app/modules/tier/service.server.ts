import type { User } from "@prisma/client";
import { db } from "~/database";

export async function getUserTierLimit({ userId }: { userId: User["id"] }) {
  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      tier: {
        select: { tierLimit: true },
      },
    },
  });
  return user?.tier?.tierLimit || null;
}

export async function assetUserCanImportAssets({
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
    },
  });

  if (!user?.tier?.tierLimit || !user?.tier?.tierLimit?.canImportAssets) {
    throw new Error("User cannot import assets");
  }
  return true;
}
