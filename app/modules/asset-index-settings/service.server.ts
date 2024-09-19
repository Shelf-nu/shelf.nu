import { co } from "node_modules/@fullcalendar/core/internal-common";
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
