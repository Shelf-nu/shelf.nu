import type { CustomField, AssetIndexMode } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { ShelfError, type ErrorLabel } from "~/utils/error";
import type { Column, ColumnLabelKey } from "./helpers";
import {
  barcodeFields,
  defaultFields,
  fixedFields,
  generateBarcodeColumns,
} from "./helpers";
import { getOrganizationById } from "../organization/service.server";

/**
 * Re-export the Supabase row type so consumers can reference it without
 * importing directly from `@shelf/database`.
 */
export type { AssetIndexSettingsRow } from "@shelf/database/types";

/**
 * Derive the default asset index mode for a given organization role.
 * BASE and SELF_SERVICE should remain in simple mode; elevated roles default to advanced.
 */
function getDefaultModeForRole(
  role?: OrganizationRoles | null
): Sb.AssetIndexMode {
  if (
    !role ||
    role === OrganizationRoles.BASE ||
    role === OrganizationRoles.SELF_SERVICE
  ) {
    return "SIMPLE";
  }

  return "ADVANCED";
}

const label: ErrorLabel = "Asset Index Settings";

export async function createUserAssetIndexSettings({
  userId,
  organizationId,
  canUseBarcodes = false,
  role,
}: {
  userId: string;
  organizationId: string;
  canUseBarcodes?: boolean;
  /** User's role to determine default mode */
  role?: OrganizationRoles;
}) {
  try {
    const org = await getOrganizationById(organizationId, {
      customFields: {
        where: { active: true, deletedAt: null },
      },
    });

    /** We start at the default fields length */
    let position = defaultFields.length - 1;

    // Add barcode columns if enabled
    const barcodeColumns = canUseBarcodes ? generateBarcodeColumns() : [];
    position += barcodeColumns.length;

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

    const columns = [
      ...defaultFields,
      ...barcodeColumns,
      ...customFieldsColumns,
    ];

    // Align initial mode based on the user's role
    const defaultMode = getDefaultModeForRole(role);

    const { data, error } = await sbDb
      .from("AssetIndexSettings")
      .insert({
        userId,
        organizationId,
        mode: defaultMode,
        columns: columns as unknown as Record<string, unknown>[],
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to create asset index settings.",
      message:
        "We couldn't create the asset index settings for the current user and organization. Please refresh to try again. If the issue persists, please contact support",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function getAssetIndexSettings({
  userId,
  organizationId,
  canUseBarcodes = false,
  role,
}: {
  userId: string;
  organizationId: string;
  canUseBarcodes?: boolean;
  role?: OrganizationRoles;
}) {
  try {
    const { data: assetIndexSettings, error } = await sbDb
      .from("AssetIndexSettings")
      .select()
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (error) throw error;

    /** Create new settings if none exist */
    if (!assetIndexSettings) {
      return await createUserAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });
    }

    /** Validate and potentially update columns structure */
    const validatedSettings = await validateColumns({
      userId,
      organizationId,
      columns: assetIndexSettings.columns as Column[],
      canUseBarcodes,
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

/**
 * Ensure a user's asset index settings align with the defaults for their role.
 * Creates settings when missing and promotes to ADVANCED when the role allows.
 */
export async function ensureAssetIndexModeForRole({
  userId,
  organizationId,
  role,
}: {
  userId: string;
  organizationId: string;
  role?: OrganizationRoles | null;
}) {
  const desiredMode = getDefaultModeForRole(role);

  const { data: settings, error } = await sbDb
    .from("AssetIndexSettings")
    .select()
    .eq("userId", userId)
    .eq("organizationId", organizationId)
    .maybeSingle();

  if (error) throw error;

  if (!settings) {
    return createUserAssetIndexSettings({
      userId,
      organizationId,
      role: role ?? undefined,
    });
  }

  if (desiredMode === "ADVANCED" && settings.mode !== "ADVANCED") {
    const { data: updated, error: updateError } = await sbDb
      .from("AssetIndexSettings")
      .update({ mode: "ADVANCED" as Sb.AssetIndexMode })
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (updateError) throw updateError;

    return updated;
  }

  return settings;
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
    const { data, error } = await sbDb
      .from("AssetIndexSettings")
      .update({ mode })
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try again. If the issue persists, please contact support",
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
    const { data, error } = await sbDb
      .from("AssetIndexSettings")
      .update({ columns: columns as unknown as Record<string, unknown>[] })
      .eq("userId", userId)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try again. If the issue persists, please contact support",
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
    const { data: settings, error } = await sbDb
      .from("AssetIndexSettings")
      .select()
      .eq("organizationId", newField.organizationId);

    if (error) throw error;

    const updates = (settings ?? []).map((entry) => {
      const columns = (entry.columns as Column[]) ?? [];
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

      return sbDb
        .from("AssetIndexSettings")
        .update({
          columns: columns as unknown as Record<string, unknown>[],
        })
        .eq("id", entry.id);
    });

    await Promise.all(updates.filter(Boolean));
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for the current user and organization. Please refresh to try again. If the issue persists, please contact support",
      additionalData: { newField, oldField },
      label,
    });
  }
}

/**
 * Removes a custom field column from every asset index configuration that belongs to an organization.
 * Uses a single SQL statement to efficiently filter the JSON columns payload for all matching rows.
 */
export async function removeCustomFieldFromAssetIndexSettings({
  customFieldName,
  organizationId,
}: {
  customFieldName: string;
  organizationId: string;
}) {
  try {
    const columnName = `cf_${customFieldName}`;

    const { error } = await sbDb.rpc("remove_custom_field_from_asset_index", {
      column_name: columnName,
      organization_id: organizationId,
    });

    if (error) throw error;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Failed to update asset index settings.",
      message:
        "We couldn't update the asset index settings for all users in your organization. This operation affects everyone's column configurations. Please try again. If the issue persists, please contact support.",
      additionalData: { customFieldName, organizationId },
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
    const { data: settings, error } = await sbDb
      .from("AssetIndexSettings")
      .select()
      .eq("organizationId", organizationId);

    if (error) throw error;

    // For each user's settings, update their columns
    const updates = (settings ?? []).map((setting) => {
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

      return sbDb
        .from("AssetIndexSettings")
        .update({
          columns: [...existingColumns, ...newColumns] as unknown as Record<
            string,
            unknown
          >[],
        })
        .eq("id", setting.id);
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
  canUseBarcodes = false,
}: {
  userId: string;
  organizationId: string;
  columns: Column[];
  canUseBarcodes?: boolean;
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

    // 2. Handle barcode columns based on permissions
    const existingBarcodeColumns = updatedColumns.filter((col) =>
      barcodeFields.includes(col.name as any)
    );

    if (canUseBarcodes) {
      // Add missing barcode columns if barcodes are enabled
      const missingBarcodeFields = barcodeFields.filter(
        (field) => !existingBarcodeColumns.some((col) => col.name === field)
      );

      if (missingBarcodeFields.length > 0) {
        // Insert barcode columns right after default fields
        const barcodeStartPosition = defaultFields.length;

        // Create new barcode columns at their intended positions
        const newBarcodeColumns = missingBarcodeFields.map((field, index) => ({
          name: field,
          visible: true,
          position: barcodeStartPosition + index,
        }));

        // Shift existing columns that come after barcode positions
        const adjustedColumns = updatedColumns.map((col) => {
          if (
            col.position >= barcodeStartPosition &&
            !col.name.startsWith("barcode_")
          ) {
            return {
              ...col,
              position: col.position + missingBarcodeFields.length,
            };
          }
          return col;
        });

        updatedColumns = [...adjustedColumns, ...newBarcodeColumns];
        needsUpdate = true;
      }
    } else {
      // Remove barcode columns if barcodes are disabled
      if (existingBarcodeColumns.length > 0) {
        updatedColumns = updatedColumns.filter(
          (col) => !barcodeFields.includes(col.name as any)
        );
        needsUpdate = true;
      }
    }

    // 3. Validate custom field columns structure
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
      const { data: customFields, error: cfError } = await sbDb
        .from("CustomField")
        .select("name, type")
        .eq("organizationId", organizationId)
        .eq("active", true)
        .is("deletedAt", null);

      if (cfError) throw cfError;

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
