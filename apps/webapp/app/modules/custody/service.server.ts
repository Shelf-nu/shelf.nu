import type { Asset } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

/**
 * Releases all custody for an asset, setting its status to AVAILABLE.
 * For INDIVIDUAL assets, this deletes the single custody record.
 * For QUANTITY_TRACKED assets, use releaseQuantity() in the asset service
 * instead — this function releases ALL custodians at once.
 */
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
          deleteMany: {},
        },
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
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
