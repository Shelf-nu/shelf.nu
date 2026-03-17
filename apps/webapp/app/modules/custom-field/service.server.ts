import type { CustomField } from "@prisma/client";
import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";

/** Coerce Supabase string dates to Date objects for Prisma compatibility */
function coerceCustomFieldDates(row: Sb.CustomFieldRow): CustomField {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import type { CustomFieldDraftPayload } from "./types";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import type { Column } from "../asset-index-settings/helpers";
import {
  removeCustomFieldFromAssetIndexSettings,
  updateAssetIndexSettingsAfterCfUpdate,
  updateAssetIndexSettingsWithNewCustomFields,
} from "../asset-index-settings/service.server";

const label: ErrorLabel = "Custom fields";

/**
 * Helper to fetch categories for a set of custom field IDs via the join table.
 * Returns a map of customFieldId -> array of Category rows.
 */
async function getCategoriesForCustomFieldIds(
  customFieldIds: string[]
): Promise<Map<string, Sb.CategoryRow[]>> {
  const map = new Map<string, Sb.CategoryRow[]>();
  if (customFieldIds.length === 0) return map;

  // Get all join table entries for these custom fields (B = customFieldId)
  const { data: joins, error: joinError } = await sbDb
    .from("_CategoryToCustomField")
    .select("*")
    .in("B", customFieldIds);

  if (joinError) throw joinError;

  if (!joins || joins.length === 0) return map;

  // Get unique category IDs (A = categoryId)
  const categoryIds = [...new Set(joins.map((j) => j.A))];

  const { data: categories, error: catError } = await sbDb
    .from("Category")
    .select("*")
    .in("id", categoryIds);

  if (catError) throw catError;

  const categoryMap = new Map((categories ?? []).map((c) => [c.id, c]));

  // Build the result map
  for (const join of joins) {
    const cat = categoryMap.get(join.A);
    if (cat) {
      const existing = map.get(join.B) ?? [];
      existing.push(cat);
      map.set(join.B, existing);
    }
  }

  return map;
}

export async function createCustomField({
  name,
  helpText,
  type,
  required,
  organizationId,
  active,
  userId,
  options = [],
  categories = [],
}: CustomFieldDraftPayload) {
  try {
    // Insert the custom field and fetch settings in parallel
    const [insertResult, settingsResult] = await Promise.all([
      sbDb
        .from("CustomField")
        .insert({
          name,
          helpText,
          type,
          required,
          active,
          options,
          organizationId,
          userId,
        })
        .select()
        .single(),
      sbDb
        .from("AssetIndexSettings")
        .select()
        .eq("organizationId", organizationId),
    ]);

    if (insertResult.error) throw insertResult.error;
    const customField = insertResult.data;

    if (settingsResult.error) throw settingsResult.error;

    // Connect categories via join table
    if (categories.length > 0) {
      const { error: catError } = await sbDb
        .from("_CategoryToCustomField")
        .insert(
          categories.map((categoryId) => ({
            A: categoryId,
            B: customField.id,
          }))
        );

      if (catError) throw catError;
    }

    /** We need to add it to the advanced index settings for each entry belonging to this organization */
    if (customField.active) {
      await Promise.all(
        (settingsResult.data ?? []).map(async (entry) => {
          const columns = (entry.columns as Column[]) ?? [];
          const prevHighestPosition = columns.reduce(
            (acc, col) => (col.position > acc ? col.position : acc),
            0
          );

          columns.push({
            name: `cf_${customField.name}`,
            visible: true,
            position: prevHighestPosition + 1,
          });

          const { error: updateError } = await sbDb
            .from("AssetIndexSettings")
            .update({
              columns: columns as unknown as Record<string, unknown>[],
            })
            .eq("id", entry.id)
            .eq("organizationId", organizationId);

          if (updateError) throw updateError;
        })
      );
    }

    return customField;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Custom field", {
      additionalData: { userId, organizationId },
    });
  }
}

export async function getFilteredAndPaginatedCustomFields(params: {
  organizationId: string;
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    let query = sbDb
      .from("CustomField")
      .select("*", { count: "exact" })
      .eq("organizationId", organizationId)
      .is("deletedAt", null)
      .order("active", { ascending: false })
      .order("updatedAt", { ascending: false })
      .range(skip, skip + take - 1);

    /** If the search string exists, add it to the query */
    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const [fieldsResult, usageCounts] = await Promise.all([
      query,

      /**
       * Get usage counts for all custom fields in this organization
       * Uses COUNT(DISTINCT "assetId") to ensure each asset is counted only once per custom field,
       * preventing inflated counts if duplicate AssetCustomFieldValue records exist
       */
      sbDb
        .rpc("get_custom_field_usage_counts", {
          organization_id: organizationId,
        })
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []) as Array<{
            customFieldId: string;
            count: number;
          }>;
        }),
    ]);

    if (fieldsResult.error) throw fieldsResult.error;

    const customFields = fieldsResult.data ?? [];
    const totalCustomFields = fieldsResult.count ?? 0;

    // Fetch categories for all custom fields via the join table
    const categoriesMap = await getCategoriesForCustomFieldIds(
      customFields.map((f) => f.id)
    );

    /** Create a map of custom field ID to usage count */
    const usageCountMap = new Map(
      usageCounts.map((item) => [item.customFieldId, Number(item.count)])
    );

    /** Attach usage count and categories to each custom field */
    const customFieldsWithUsage = customFields.map((field) => ({
      ...field,
      categories: categoriesMap.get(field.id) ?? [],
      usageCount: usageCountMap.get(field.id) || 0,
    }));

    return {
      customFields: customFieldsWithUsage,
      totalCustomFields,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the custom fields",
      additionalData: { ...params },
      label,
    });
  }
}

export async function getCustomField({
  organizationId,
  id,
  userOrganizations,
  request,
  include,
}: {
  id: string;
  organizationId: string;
  userOrganizations?: { organizationId: string }[];
  request?: Request;
  include?: { categories?: boolean | { select?: { id?: boolean } } };
}) {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    // Build the query for the custom field
    let query = sbDb
      .from("CustomField")
      .select("*")
      .is("deletedAt", null)
      .eq("id", id);

    if (userOrganizations?.length && otherOrganizationIds?.length) {
      // Match either the current org or any of the user's other orgs
      query = query.in("organizationId", [
        organizationId,
        ...otherOrganizationIds,
      ]);
    } else {
      query = query.eq("organizationId", organizationId);
    }

    const { data: customField, error } = await query.maybeSingle();

    if (error) throw error;

    if (!customField) {
      throw new ShelfError({
        cause: null,
        title: "Custom field not found",
        message:
          "The custom field you are trying to access does not exist or you do not have permission to access it.",
        additionalData: { id, organizationId },
        label,
        status: 404,
      });
    }

    /* User is trying to access customField in wrong organization. */
    if (
      userOrganizations?.length &&
      customField.organizationId !== organizationId &&
      otherOrganizationIds?.includes(customField.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Custom field not found",
        message: "",
        additionalData: {
          model: "customField",
          organization: userOrganizations.find(
            (org) => org.organizationId === customField.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    // If include.categories is requested, fetch categories via join table
    if (include?.categories) {
      const categoriesMap = await getCategoriesForCustomFieldIds([
        customField.id,
      ]);
      const categories = categoriesMap.get(customField.id) ?? [];

      // If include.categories.select.id is set, only return id
      const includeObj = include.categories;
      if (typeof includeObj === "object" && includeObj.select?.id) {
        return {
          ...customField,
          categories: categories.map((c) => ({ id: c.id })),
        };
      }

      return { ...customField, categories };
    }

    return customField;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      title: "Custom field not found",
      message:
        "The custom field you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function updateCustomField(payload: {
  id: string;
  name?: string;
  helpText?: string | null;
  type?: Sb.CustomFieldType;
  required?: boolean;
  active?: boolean;
  options?: string[];
  categories?: string[];
  organizationId: string;
}) {
  const {
    id,
    name,
    helpText,
    required,
    active,
    options,
    categories,
    organizationId,
  } = payload;

  try {
    //dont ever update type
    //updating type would require changing all custom field values to that type
    //which might fail when changing to incompatible type hence need a careful definition
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (helpText !== undefined) updateData.helpText = helpText;
    if (required !== undefined) updateData.required = required;
    if (active !== undefined) updateData.active = active;
    if (options !== undefined) updateData.options = options;

    /** Get the custom field. We need it in order to be able to update the asset index settings */
    const { data: customField, error: findError } = await sbDb
      .from("CustomField")
      .select("*")
      .eq("id", id)
      .eq("organizationId", organizationId)
      .is("deletedAt", null)
      .maybeSingle();

    if (findError) throw findError;
    if (!customField) {
      throw new ShelfError({
        cause: null,
        message: "Custom field not found",
        additionalData: { id, organizationId },
        label,
        status: 404,
      });
    }

    const { data: updatedField, error: updateError } = await sbDb
      .from("CustomField")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Handle categories via join table if provided
    if (categories !== undefined) {
      // Remove all existing category associations
      const { error: deleteError } = await sbDb
        .from("_CategoryToCustomField")
        .delete()
        .eq("B", id);

      if (deleteError) throw deleteError;

      // Insert new category associations
      if (categories.length > 0) {
        const { error: insertError } = await sbDb
          .from("_CategoryToCustomField")
          .insert(
            categories.map((categoryId) => ({
              A: categoryId,
              B: id,
            }))
          );

        if (insertError) throw insertError;
      }
    }

    /** Updates the Asset index settings */
    await updateAssetIndexSettingsAfterCfUpdate({
      oldField: customField as unknown as CustomField,
      newField: updatedField as unknown as CustomField,
    });

    return updatedField;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Custom field", {
      additionalData: {
        id,
      },
    });
  }
}

/**
 * Soft deletes a custom field by setting its deletedAt timestamp and appending a Unix timestamp to the name.
 *
 * This operation:
 * 1. Appends Unix timestamp to the field name (e.g., "Serial Number" → "Serial Number_1234567890")
 * 2. Sets deletedAt to current timestamp (soft delete)
 * 3. Immediately removes the column from all users' AssetIndexSettings
 * 4. Preserves all AssetCustomFieldValue records (no CASCADE deletion)
 * 5. Deleted fields don't count toward premium tier limits
 * 6. Name is freed up for creating a new field with the same name
 *
 * Note: This is a soft delete - data is preserved but not restorable via name reuse.
 * The `active` flag remains separate and controls feature toggle functionality.
 *
 * @throws ShelfError if custom field doesn't exist or deletion fails
 */
export async function softDeleteCustomField({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  try {
    // 1. Verify the custom field exists, belongs to the organization, and is not already deleted
    const { data: existingCustomField, error: findError } = await sbDb
      .from("CustomField")
      .select("*")
      .eq("id", id)
      .eq("organizationId", organizationId)
      .is("deletedAt", null)
      .maybeSingle();

    if (findError) throw findError;

    if (!existingCustomField) {
      throw new ShelfError({
        cause: null,
        message: "The custom field you are trying to delete does not exist.",
        additionalData: { id, organizationId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    // 2. Soft delete the custom field by appending timestamp to name and setting deletedAt
    // This frees up the original name for creating a new field
    const timestamp = Math.floor(Date.now() / 1000);
    const { data: deletedField, error: updateError } = await sbDb
      .from("CustomField")
      .update({
        name: `${existingCustomField.name}_${timestamp}`,
        deletedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // 3. Remove column from all users' AssetIndexSettings immediately
    // This ensures consistency with deactivation behavior
    await removeCustomFieldFromAssetIndexSettings({
      customFieldName: existingCustomField.name,
      organizationId,
    });

    return deletedField;
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the custom field. Please try again or contact support.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function upsertCustomField(
  definitions: CustomFieldDraftPayload[]
): Promise<{
  customFields: Record<string, Sb.CustomFieldRow>;
  newOrUpdatedFields: Sb.CustomFieldRow[];
}> {
  try {
    const customFields: Record<string, Sb.CustomFieldRow> = {};
    const newOrUpdatedFields: Sb.CustomFieldRow[] = [];

    for (const def of definitions) {
      const { data: existingCustomField, error: findError } = await sbDb
        .from("CustomField")
        .select("*")
        .ilike("name", def.name)
        .eq("organizationId", def.organizationId)
        .is("deletedAt", null)
        .maybeSingle();

      if (findError) throw findError;

      if (!existingCustomField) {
        const newCustomField = await createCustomField(def);
        customFields[def.name] = newCustomField;
        newOrUpdatedFields.push(newCustomField);
      } else {
        if (existingCustomField.type !== def.type) {
          throw new ShelfError({
            cause: null,
            message: `Duplicate custom field name with different type. '${def.name}' already exist with different type '${existingCustomField.type}'`,
            additionalData: {
              validationErrors: {
                name: {
                  message: `${def.name} already exist with different type ${existingCustomField.type}`,
                },
              },
            },
            label,
            shouldBeCaptured: false,
          });
        }
        if (existingCustomField.type === "OPTION") {
          const newOptions = def.options?.filter(
            (op) => !existingCustomField?.options?.includes(op)
          );
          if (newOptions?.length) {
            //create non existing options
            const options = (existingCustomField?.options || []).concat(
              Array.from(new Set(newOptions))
            );
            const updatedCustomField = await updateCustomField({
              id: existingCustomField.id,
              options,
              organizationId: def.organizationId,
            });
            customFields[def.name] = updatedCustomField;
            newOrUpdatedFields.push(updatedCustomField);
          } else {
            customFields[def.name] = existingCustomField;
          }
        } else {
          customFields[def.name] = existingCustomField;
        }
      }
    }

    // Update asset index settings if we have any new or updated fields
    if (newOrUpdatedFields.length > 0) {
      void updateAssetIndexSettingsWithNewCustomFields({
        newCustomFields: newOrUpdatedFields as unknown as CustomField[],
        organizationId: definitions[0].organizationId,
      });
    }

    return { customFields, newOrUpdatedFields };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to update or create custom fields. Please try again or contact support.",
      additionalData: { definitions },
      label: "Custom fields",
    });
  }
}

export async function createCustomFieldsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: string;
  organizationId: string;
}) {
  try {
    //{CF header:[all options in csv combined]}
    const optionMap: Record<string, string[]> = {};
    //{CF header: definition to create}
    const fieldToDefDraftMap: Record<string, CustomFieldDraftPayload> = {};

    for (const item of data) {
      for (const k of Object.keys(item)) {
        if (k.startsWith("cf:")) {
          const def = getDefinitionFromCsvHeader(k);
          if (!fieldToDefDraftMap[k]) {
            fieldToDefDraftMap[k] = { ...def, userId, organizationId };
          }
          /** Only add the options if they have a value */
          if (def.type === "OPTION" && item[k] !== "") {
            optionMap[k] = (optionMap[k] || []).concat([item[k]]);
          }
        }
      }
    }

    for (const [customFieldDefStr, def] of Object.entries(fieldToDefDraftMap)) {
      if (def.type === "OPTION" && optionMap[customFieldDefStr]?.length) {
        const uniqueSet = new Set(optionMap[customFieldDefStr]);
        def.options = Array.from(uniqueSet);
      }
    }
    return await upsertCustomField(Object.values(fieldToDefDraftMap));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while creating custom fields. Seems like some of the custom field data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

/**
 * Retrieves active custom fields for an organization with flexible category filtering
 *
 * Usage:
 * 1. Get ALL active custom fields regardless of category:
 *    await getActiveCustomFields({ organizationId, includeAllCategories: true })
 *
 * 2. Get custom fields for a specific category + uncategorized fields:
 *    await getActiveCustomFields({ organizationId, category: "categoryId" })
 *
 * 3. Get ONLY uncategorized custom fields:
 *    await getActiveCustomFields({ organizationId })
 *
 * @param params.organizationId - The organization ID to fetch custom fields for
 * @param params.category - Optional category ID to filter by. When provided, returns fields specific to this category AND uncategorized fields
 * @param params.includeAllCategories - When true, ignores category filtering and returns ALL active custom fields. Takes precedence over category param
 *
 * @returns Array of CustomField objects that are active and match the category filtering criteria
 *
 * @example
 * // Get all active custom fields for asset index or similar global contexts
 * const allCustomFields = await getActiveCustomFields({
 *   organizationId,
 *   includeAllCategories: true
 * });
 *
 * @example
 * // Get custom fields for a specific asset category plus uncategorized fields
 * const categoryCustomFields = await getActiveCustomFields({
 *   organizationId,
 *   category: assetCategoryId
 * });
 */
export async function getActiveCustomFields({
  organizationId,
  category,
  includeAllCategories = false,
}: {
  organizationId: string;
  category?: string | null;
  includeAllCategories?: boolean;
}) {
  try {
    // Get all active, non-deleted custom fields for this org
    const { data: allFields, error } = await sbDb
      .from("CustomField")
      .select("*")
      .eq("organizationId", organizationId)
      .eq("active", true)
      .is("deletedAt", null);

    if (error) throw error;

    const fields = (allFields ?? []).map(coerceCustomFieldDates);

    // If includeAllCategories, return all fields without category filtering
    if (includeAllCategories) {
      return fields;
    }

    // We need category info for filtering
    const fieldIds = fields.map((f) => f.id);
    const categoriesMap = await getCategoriesForCustomFieldIds(fieldIds);

    if (typeof category === "string") {
      /**
       * Category filtering: return fields that are either:
       * - Uncategorized (no categories)
       * - Associated with the given category
       */
      return fields.filter((field) => {
        const cats = categoriesMap.get(field.id) ?? [];
        return cats.length === 0 || cats.some((c) => c.id === category);
      });
    }

    // Default: return only uncategorized fields
    return fields.filter((field) => {
      const cats = categoriesMap.get(field.id) ?? [];
      return cats.length === 0;
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Failed to get active custom fields. Please try again or contact support.",
      additionalData: { organizationId, category, includeAllCategories },
      label,
    });
  }
}

export async function countActiveCustomFields({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    const { count, error } = await sbDb
      .from("CustomField")
      .select("*", { count: "exact", head: true })
      .eq("organizationId", organizationId)
      .eq("active", true)
      .is("deletedAt", null);

    if (error) throw error;

    return count ?? 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching active custom fields. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function bulkActivateOrDeactivateCustomFields({
  customFields,
  organizationId,
  userId,
  active,
}: {
  customFields: Sb.CustomFieldRow[];
  organizationId: string;
  userId: string;
  active: boolean;
}) {
  try {
    const customFieldsIds = customFields.map((field) => field.id);

    const { error: updateError } = await sbDb
      .from("CustomField")
      .update({ active })
      .in("id", customFieldsIds)
      .eq("organizationId", organizationId);

    if (updateError) throw updateError;

    /** Get the asset index settings for the organization */
    const { data: settings, error: settingsError } = await sbDb
      .from("AssetIndexSettings")
      .select()
      .eq("organizationId", organizationId);

    if (settingsError) throw settingsError;

    /** Update the asset index settings for each entry */
    const updates = (settings ?? []).map((entry) => {
      const columns = (entry.columns as Column[]) ?? [];

      customFields.forEach((field) => {
        const oldField = field;
        const newField = { ...field, active };
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
      });

      return sbDb
        .from("AssetIndexSettings")
        .update({
          columns: columns as unknown as Record<string, unknown>[],
        })
        .eq("id", entry.id)
        .eq("organizationId", organizationId);
    });

    await Promise.all(updates.filter(Boolean));

    return { count: customFieldsIds.length };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk activating custom fields.",
      additionalData: { customFields, organizationId, userId },
      label,
    });
  }
}
