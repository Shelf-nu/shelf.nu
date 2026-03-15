import type {
  CustomField,
  Organization,
  User,
  UserOrganization,
} from "@shelf/database";
import { db } from "~/database/db.server";
import {
  count,
  create,
  createMany,
  deleteMany,
  findFirst,
  findMany,
  update,
  updateMany,
} from "~/database/query-helpers.server";
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
    const [customField, assetIndexSettingsEntries] = await Promise.all([
      create(db, "CustomField", {
        name,
        helpText,
        type,
        required,
        active,
        options,
        organizationId,
        userId,
      }),
      findMany(db, "AssetIndexSettings", {
        where: { organizationId },
      }),
    ]);

    // Handle category connections separately via join table
    if (categories.length > 0) {
      const categoryConnections = categories.map((categoryId) => ({
        customFieldId: customField.id,
        categoryId,
      }));
      await createMany(db, "CategoryToCustomField", categoryConnections);
    }

    /** We need to add it to the advanced index settings for each entry belonging to this organization */
    if (customField.active) {
      await Promise.all(
        assetIndexSettingsEntries.map(async (entry) => {
          const columns = Array.from(entry.columns as unknown as Column[]);
          const prevHighestPosition = columns.reduce(
            (acc, col) => (col.position > acc ? col.position : acc),
            0
          );

          columns.push({
            name: `cf_${customField.name}`,
            visible: true,
            position: prevHighestPosition + 1,
          });

          await update(db, "AssetIndexSettings", {
            where: { id: entry.id, organizationId },
            data: { columns: columns as any },
          });
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
  organizationId: Organization["id"];
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

    /** Default value of where. Takes the items belonging to current user */
    const where: Record<string, unknown> = {
      organizationId,
      deletedAt: null,
    };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [customFields, totalCustomFields, usageCounts] = await Promise.all([
      /** Get the items */
      findMany(db, "CustomField", {
        skip,
        take,
        where,
        orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
        select: "*, categories:CategoryToCustomField(categoryId, Category(*))",
      }),

      /** Count them */
      count(db, "CustomField", where),

      /**
       * Get usage counts for all custom fields in this organization
       * Uses RPC to run raw SQL via Supabase
       */
      db
        .rpc("get_custom_field_usage_counts", {
          p_organization_id: organizationId,
        })
        .then((result) => {
          if (result.error) throw result.error;
          return (result.data || []) as Array<{
            customFieldId: string;
            count: number;
          }>;
        }),
    ]);

    /** Create a map of custom field ID to usage count */
    const usageCountMap = new Map(
      usageCounts.map((item) => [item.customFieldId, Number(item.count)])
    );

    /** Attach usage count to each custom field */
    const customFieldsWithUsage = customFields.map((field: any) => ({
      ...field,
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
}: Pick<CustomField, "id"> & {
  organizationId: Organization["id"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
  include?: Record<string, unknown>;
}) {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const where: Record<string, unknown> = {
      deletedAt: null,
      OR: [
        { id, organizationId },
        ...(userOrganizations?.length
          ? [{ id, organizationId: { in: otherOrganizationIds } }]
          : []),
      ],
    };

    // Build select string based on include
    let select = "*";
    if (include) {
      const joins: string[] = ["*"];
      if ("categories" in include) {
        joins.push("categories:CategoryToCustomField(categoryId, Category(*))");
      }
      select = joins.join(", ");
    }

    const customField = await findFirst(db, "CustomField", {
      where,
      select,
    });

    if (!customField) {
      throw { code: "PGRST116", message: "No rows found in CustomField" };
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
  id: CustomField["id"];
  name?: CustomField["name"];
  helpText?: CustomField["helpText"];
  type?: CustomField["type"];
  required?: CustomField["required"];
  active?: CustomField["active"];
  options?: CustomField["options"];
  categories?: string[];
  organizationId: CustomField["organizationId"];
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
    const data: Record<string, unknown> = {
      name,
      helpText,
      required,
      active,
      options,
    };

    /** Get the custom field. We need it in order to be able to update the asset index settings */
    const customField = (await findFirst(db, "CustomField", {
      where: { id, organizationId, deletedAt: null },
    })) as CustomField;

    const updatedField = await update(db, "CustomField", {
      where: { id },
      data,
    });

    // Handle category relations via join table
    const hasCategories = categories && categories.length > 0;

    // Remove existing category connections
    await deleteMany(db, "CategoryToCustomField", {
      customFieldId: id,
    });

    // Add new category connections if any
    if (hasCategories) {
      const categoryConnections = categories.map((categoryId) => ({
        customFieldId: id,
        categoryId,
      }));
      await createMany(db, "CategoryToCustomField", categoryConnections);
    }

    /** Updates the Asset */
    await updateAssetIndexSettingsAfterCfUpdate({
      oldField: customField,
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
 * 1. Appends Unix timestamp to the field name (e.g., "Serial Number" -> "Serial Number_1234567890")
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
}: Pick<CustomField, "id"> & { organizationId: Organization["id"] }) {
  try {
    // Use RPC for the cascade soft delete operation
    const { error } = await db.rpc("delete_custom_field_cascade", {
      p_custom_field_id: id,
      p_organization_id: organizationId,
      p_custom_field_name: "",
    });

    // 1. Verify the custom field exists, belongs to the organization, and is not already deleted
    const existingCustomField = await findFirst(db, "CustomField", {
      where: { id, organizationId, deletedAt: null },
    });

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
    const deletedField = await update(db, "CustomField", {
      where: { id },
      data: {
        name: `${existingCustomField.name}_${timestamp}`,
        deletedAt: new Date().toISOString(),
      },
    });

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
  customFields: Record<string, CustomField>;
  newOrUpdatedFields: CustomField[];
}> {
  try {
    const customFields: Record<string, CustomField> = {};
    const newOrUpdatedFields: CustomField[] = [];

    for (const def of definitions) {
      let existingCustomField = await findFirst(db, "CustomField", {
        where: {
          name: {
            equals: def.name,
            mode: "insensitive",
          },
          organizationId: def.organizationId,
          deletedAt: null,
        },
      });

      if (!existingCustomField) {
        const newCustomField = await createCustomField(def);
        customFields[def.name] = newCustomField as unknown as CustomField;
        newOrUpdatedFields.push(newCustomField as unknown as CustomField);
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
            existingCustomField =
              updatedCustomField as unknown as typeof existingCustomField;
            newOrUpdatedFields.push(
              updatedCustomField as unknown as CustomField
            );
          }
        }
        customFields[def.name] = existingCustomField as unknown as CustomField;
      }
    }

    // Update asset index settings if we have any new or updated fields
    if (newOrUpdatedFields.length > 0) {
      void updateAssetIndexSettingsWithNewCustomFields({
        newCustomFields: newOrUpdatedFields,
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
  userId: User["id"];
  organizationId: Organization["id"];
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
    // When including all categories, no relation filtering needed
    if (includeAllCategories) {
      return await findMany(db, "CustomField", {
        where: {
          organizationId,
          active: true,
          deletedAt: null,
        },
      });
    }

    // For category-based filtering, use RPC since Supabase PostgREST
    // doesn't support relation-based filtering like Prisma's none/some
    const result = await db.rpc("get_active_custom_fields_by_category", {
      p_organization_id: organizationId,
      p_category_id: category || null,
    });

    if (result.error) throw result.error;
    return result.data || [];
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
    return await count(db, "CustomField", {
      organizationId,
      active: true,
      deletedAt: null,
    });
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
  customFields: CustomField[];
  organizationId: CustomField["organizationId"];
  userId: CustomField["userId"];
  active: boolean;
}) {
  try {
    const customFieldsIds = customFields.map((field) => field.id);

    const updatedFields = await updateMany(db, "CustomField", {
      where: { id: { in: customFieldsIds }, organizationId },
      data: { active },
    });

    /** Get the asset index settings for the organization */
    const settings = await findMany(db, "AssetIndexSettings", {
      where: { organizationId },
    });

    /** Update the asset index settings for each entry */
    const updates = settings.map((entry) => {
      const columns = Array.from(
        entry.columns as unknown as Column[]
      ) as Column[];

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

      return update(db, "AssetIndexSettings", {
        where: { id: entry.id, organizationId },
        data: { columns: columns as any },
      });
    });

    await Promise.all(updates.filter(Boolean));

    return updatedFields;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk activating custom fields.",
      additionalData: { customFields, organizationId, userId },
      label,
    });
  }
}
