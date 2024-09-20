import type { AssetIndexMode } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError, type ErrorLabel } from "~/utils/error";

const label: ErrorLabel = "Asset Index Settings";

export async function getAssetIndexSettings({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  try {
    const assetIndexSettings = await db.assetIndexSettings.findFirst({
      where: { userId, organizationId },
    });

    return assetIndexSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Asset Index Settings not found.",
      message:
        "We couldn't find the asset index settings for the current user and organization. Please refresh to try agian. If the issue persists, please contact support",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function changeMode({
  userId,
  organizationId,
  mode,
}: {
  userId: string;
  organizationId: string;
  mode: AssetIndexMode;
}) {
  try {
    const updatedAssetIndexSettings = await db.assetIndexSettings.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { mode },
    });

    return updatedAssetIndexSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try agian. If the issue persists, please contact support",
      additionalData: { userId, organizationId, mode },
      label,
    });
  }
}
