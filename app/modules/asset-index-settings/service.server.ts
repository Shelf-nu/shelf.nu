import type { AssetIndexMode, CustomField, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError, type ErrorLabel } from "~/utils/error";
import type { Column } from "./helpers";

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

/** Must receive the complete object of all columns for the entry to update it */
export async function updateColumns({
  userId,
  organizationId,
  columns,
}: {
  userId: string;
  organizationId: string;
  columns: Column[];
}) {
  try {
    const updatedAssetIndexSettings = await db.assetIndexSettings.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { columns },
    });

    return updatedAssetIndexSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try agian. If the issue persists, please contact support",
      additionalData: { userId, organizationId, columns },
      label,
    });
  }
}

/** Updating a CustomField requires us to update the settings. Use this to handle the logic */
export async function updateAssetIndexSettingsAfterCfUpdate({
  oldField,
  newField,
}: {
  /** The original field */
  oldField: CustomField;

  /** The updated field */
  newField: CustomField;
}) {
  try {
    const settings = await db.assetIndexSettings.findMany({
      where: { organizationId: newField.organizationId },
    });

    const updates = settings.map((entry) => {
      const columns = Array.from(entry.columns as Prisma.JsonArray) as Column[];
      const cfIndex = columns.findIndex(
        (col) => col?.name === `cf_${oldField.name}`
      );

      if (newField.active) {
        /** Field is missing so we add it */
        if (cfIndex === -1) {
          const prevHighestPosition = columns.reduce(
            (acc, col) => (col.position > acc ? col.position : acc),
            0
          );
          columns.push({
            name: `cf_${newField.name}`,
            visible: true,
            position: prevHighestPosition + 1,
          });
        } else {
          columns[cfIndex] = {
            name: `cf_${newField.name}`,
            visible: columns[cfIndex].visible,
            position: columns[cfIndex].position,
          };
        }
      } else {
        columns.splice(cfIndex, 1);
      }

      return db.assetIndexSettings.update({
        where: { id: entry.id },
        data: { columns },
      });
    });

    await Promise.all(updates.filter(Boolean));
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try agian. If the issue persists, please contact support",
      additionalData: { newField, oldField },
      label,
    });
  }
}
