import type { Asset } from "@shelf/database";
import { AssetStatus } from "@shelf/database";
import { db } from "~/database/db.server";
import { deleteMany, update } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

export async function releaseCustody({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    // Delete the custody record first
    await deleteMany(db, "Custody", { assetId });

    // Then update the asset status and return with joined data
    return await update(db, "Asset", {
      where: { id: assetId, organizationId },
      data: {
        status: AssetStatus.AVAILABLE,
      },
      select: "*, user:User(firstName, lastName), custody:Custody(*)",
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
