import type { Asset } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

export async function releaseCustody({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    return await db.asset.update({
      where: { id: assetId, organizationId },
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { assetId },
      label: "Custody",
    });
  }
}
