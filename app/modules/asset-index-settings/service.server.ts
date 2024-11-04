import type { AssetIndexMode, CustomField, Prisma } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import { ShelfError, type ErrorLabel } from "~/utils/error";
import type { Column, ColumnLabelKey } from "./helpers";
import { defaultFields, fixedFields } from "./helpers";
import { getOrganizationById } from "../organization/service.server";

const label: ErrorLabel = "Asset Index Settings";

export async function createUserAssetIndexSettings({
  userId,
  organizationId,
  tx,
}: {
  userId: string;
  organizationId: string;
  /** Optionally receive a transaction when the settingsd need to be created together with other entries */
  tx?: Omit<ExtendedPrismaClient, ITXClientDenyList>;
}) {
  const _db = tx || db;

  try {
    const org = await getOrganizationById(organizationId, {
      customFields: {
        where: { active: true },
      },
    });

    /** We start at the default fields length */
    let position = defaultFields.length - 1;
    const customFieldsColumns = org.customFields.map((cf) => {
      /** We increment the position for each custom field */
      position += 1;
      return {
        name: `cf_${cf.name}`,
        visible: true,
        position,
        cfType: cf.type,
      };
    });

    const columns = [...defaultFields, ...customFieldsColumns];

    const settings = await _db.assetIndexSettings.create({
      data: {
        userId,
        organizationId,
        mode: "SIMPLE",
        columns,
      },
    });

    return settings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to create asset index settings.",
      message:
        "We couldn't create the asset index settings for the current user and organization. Please refresh to try agian. If the issue persists, please contact support",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

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

    /** Create new settings if none exist */
    if (!assetIndexSettings) {
      return await createUserAssetIndexSettings({
        userId,
        organizationId,
      });
    }

    /** Validate and potentially update columns structure */
    const validatedSettings = await validateColumns({
      userId,
      organizationId,
      columns: assetIndexSettings.columns as Column[],
    });
    return validatedSettings || assetIndexSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Asset Index Settings not found.",
      message:
        "We couldn't find the asset index settings for the current user and organization. Please refresh to try again. If the issue persists, please contact support",
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
            cfType: newField.type,
          });
        } else {
          columns[cfIndex] = {
            name: `cf_${newField.name}`,
            visible: columns[cfIndex].visible,
            position: columns[cfIndex].position,
            cfType: newField.type,
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

/**
 * Updates the AssetIndexSettings for all users in an organization when new custom fields are created
 * @param newCustomFields - The newly created or updated custom fields
 * @param organizationId - The organization ID
 */
export async function updateAssetIndexSettingsWithNewCustomFields({
  newCustomFields,
  organizationId,
}: {
  newCustomFields: CustomField[];
  organizationId: string;
}) {
  try {
    // Get all asset index settings for the organization
    const settings = await db.assetIndexSettings.findMany({
      where: { organizationId },
    });

    // For each user's settings, update their columns
    const updates = settings.map((setting) => {
      const columns = setting.columns as Column[];

      // Get the highest current position
      const maxPosition = Math.max(...columns.map((col) => col.position));

      // Create new column entries for each new custom field
      const newColumns: Column[] = newCustomFields.map((field, index) => ({
        name: `cf_${field.name}`,
        visible: true,
        position: maxPosition + 1 + index,
        cfType: field.type,
      }));

      // Filter out any existing columns for these custom fields
      const existingColumns = columns.filter(
        (col) =>
          !newCustomFields.some((field) => `cf_${field.name}` === col.name)
      );

      return db.assetIndexSettings.update({
        where: { id: setting.id },
        data: {
          columns: [...existingColumns, ...newColumns],
        },
      });
    });

    await Promise.all(updates);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update asset index settings with new custom fields",
      additionalData: { organizationId },
      label: "Asset Index Settings",
    });
  }
}

/**
 * Validates both default fields and custom field columns structure
 * Only queries the database if validation issues are found
 * @returns Updated settings if changes were needed, null otherwise
 */
async function validateColumns({
  userId,
  organizationId,
  columns,
}: {
  userId: string;
  organizationId: string;
  columns: Column[];
}) {
  try {
    let needsUpdate = false;
    let updatedColumns = [...columns];

    // 1. First validate default fields existence without DB query
    const defaultFieldsNames = fixedFields.map((field) => field);
    const existingDefaultFields = updatedColumns
      .filter((col) => !col.name.startsWith("cf_"))
      .map((col) => col.name);

    // Detect missing default fields
    const missingDefaultFields: ColumnLabelKey[] = defaultFieldsNames.filter(
      (name) => !existingDefaultFields.includes(name)
    );

    // If default fields are missing, add them from our static defaults
    if (missingDefaultFields.length > 0) {
      const fieldsToAdd = defaultFields.filter((field) =>
        missingDefaultFields.includes(field.name)
      );
      updatedColumns = [...updatedColumns, ...fieldsToAdd];
      needsUpdate = true;
    }

    // 2. Validate custom field columns structure
    const customFieldColumns = updatedColumns.filter((col) =>
      col.name.startsWith("cf_")
    );

    const hasInvalidCustomFields = customFieldColumns.some(
      (col) =>
        !col.cfType ||
        typeof col.visible !== "boolean" ||
        typeof col.position !== "number"
    );

    // Only query DB if we found invalid custom fields
    if (hasInvalidCustomFields) {
      // Fetch custom fields data only when needed
      const customFields = await db.customField.findMany({
        where: {
          organizationId,
          active: true,
        },
        select: {
          name: true,
          type: true,
        },
      });

      const customFieldsMap = new Map(
        customFields.map((cf) => [cf.name, cf.type])
      );

      // Filter out non-custom field columns
      const regularColumns = updatedColumns.filter(
        (col) => !col.name.startsWith("cf_")
      );

      // Rebuild custom field columns with correct structure
      const validatedCustomFieldColumns = customFieldColumns
        .filter((col) => {
          const cfName = col.name.slice(3);
          return customFieldsMap.has(cfName);
        })
        .map((col) => {
          const cfName = col.name.slice(3);
          return {
            ...col,
            cfType: customFieldsMap.get(cfName),
            visible: Boolean(col.visible),
            position: Number(col.position),
          };
        });

      updatedColumns = [...regularColumns, ...validatedCustomFieldColumns];
      needsUpdate = true;
    }

    // Only update if changes were needed
    if (needsUpdate) {
      return await updateColumns({
        userId,
        organizationId,
        columns: updatedColumns,
      });
    }

    return null;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to validate columns structure",
      additionalData: { userId, organizationId },
      label,
    });
  }
}
