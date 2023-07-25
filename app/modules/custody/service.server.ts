import { AssetStatus, type Asset } from "@prisma/client";
import { db } from "~/database";

export const releaseCustody = async ({ assetId }: { assetId: Asset["id"] }) => {
  const asset = await db.asset.update({
    where: { id: assetId },
    data: {
      status: AssetStatus.AVAILABLE,
      custody: {
        delete: true,
      },
    },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      custody: true,
    },
  });

  return asset;
};
