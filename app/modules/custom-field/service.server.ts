import type {
  CustomField,
  Organization,
  Prisma,
  User,
  UserOrganization,
} from "@prisma/client";
import { db } from "~/database/db.server";
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
      db.customField.create({
        data: {
          name,
          helpText,
          type,
          required,
          active,
          options,
          organization: {
            connect: {
              id: organizationId,
            },
          },
          createdBy: {
            connect: {
              id: userId,
            },
          },
          categories: {
            connect: categories.map((category) => ({ id: category })),
          },
        },
      }),
      db.assetIndexSettings.findMany({
        where: { organizationId },
      }),
    ]);

    /** We need to add it to the advanced index settings for each entry belonging to this organization */
    if (customField.active) {
      await Promise.all(
        assetIndexSettingsEntries.map(async (entry) => {
          const columns = Array.from(entry.columns as Prisma.JsonArray);
          const prevHighestPosition = (columns as Column[]).reduce(
            (acc, col) => (col.position > acc ? col.position : acc),
            0
          );

          columns.push({
            name: `cf_${customField.name}`,
            visible: true,
            position: prevHighestPosition + 1,
          });

          await db.assetIndexSettings.update({
            where: { id: entry.id, organizationId },
            data: { columns },
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
    let where: Prisma.CustomFieldWhereInput = {
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

    const [customFields, totalCustomFields] = await Promise.all([
      /** Get the items */
      db.customField.findMany({
        skip,
        take,
        where,
        orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
        include: { categories: true },
      }),

      /** Count them */
      db.customField.count({ where }),
    ]);

    return { customFields, totalCustomFields };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the custom fields",
      additionalData: { ...params },
      label,
    });
  }
}

type CustomFieldWithInclude<T extends Prisma.CustomFieldInclude | undefined> =
  T extends Prisma.CustomFieldInclude
    ? Prisma.CustomFieldGetPayload<{ include: T }>
    : CustomField;

export async function getCustomField<
  T extends Prisma.CustomFieldInclude | undefined,
>({
  organizationId,
  id,
  userOrganizations,
  request,
  include,
}: Pick<CustomField, "id"> & {
  organizationId: Organization["id"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
  include?: T;
}) {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const customField = await db.customField.findFirstOrThrow({
      where: {
        deletedAt: null,
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: { ...include },
    });

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

    return customField as CustomFieldWithInclude<T>;
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
    const data = {
      name,
      helpText,
      required,
      active,
      options,
    } satisfies Prisma.CustomFieldUpdateInput;
    const hasCategories = categories && categories.length > 0;

    Object.assign(data, {
      categories: {
        set: hasCategories // if categories are empty, remove all categories
          ? categories.map((category) => ({ id: category }))
          : [],
      },
    });

    /** Get the custom field. We need it in order to be able to update the asset index settings */
    const customField = (await db.customField.findFirst({
      where: { id, organizationId, deletedAt: null },
    })) as CustomField;

    const updatedField = await db.customField.update({
      where: { id },
      data: data,
    });

    /** Updates the Asset */
    await updateAssetIndexSettingsAfterCfUpdate({
      oldField: customField,
      newField: updatedField,
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
 * 3. Preserves all AssetCustomFieldValue records (no CASCADE deletion)
 * 4. AssetIndexSettings cleanup happens lazily via validateColumns on next access
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
    const customField = await db.$transaction(
      async (tx) => {
        // 1. Verify the custom field exists, belongs to the organization, and is not already deleted
        const existingCustomField = await tx.customField.findFirst({
          where: { id, organizationId, deletedAt: null },
        });

        if (!existingCustomField) {
          throw new ShelfError({
            cause: null,
            message:
              "The custom field you are trying to delete does not exist.",
            additionalData: { id, organizationId },
            label,
            status: 404,
            shouldBeCaptured: false,
          });
        }

        // 2. Soft delete the custom field by appending timestamp to name and setting deletedAt
        // This frees up the original name for creating a new field
        const timestamp = Math.floor(Date.now() / 1000);
        const deletedField = await tx.customField.update({
          where: { id },
          data: {
            name: `${existingCustomField.name}_${timestamp}`,
            deletedAt: new Date(),
          },
        });

        return deletedField;
      },
      {
        timeout: 30000, // 30 second timeout for consistency
      }
    );

    return customField;
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
      let existingCustomField = await db.customField.findFirst({
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
            existingCustomField = updatedCustomField;
            newOrUpdatedFields.push(updatedCustomField);
          }
        }
        customFields[def.name] = existingCustomField;
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

    for (let item of data) {
      for (let k of Object.keys(item)) {
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
    return await db.customField.findMany({
      where: {
        organizationId,
        active: { equals: true },
        deletedAt: null,
        /**
         * Category filtering logic:
         * - If includeAllCategories: no category filtering
         * - If category provided: get fields for that category + uncategorized
         * - Otherwise: get only uncategorized fields
         */
        ...(includeAllCategories
          ? {} // No category filtering
          : typeof category === "string"
          ? {
              OR: [
                { categories: { none: {} } }, // Uncategorized fields
                { categories: { some: { id: category } } }, // Category-specific fields
              ],
            }
          : { categories: { none: {} } }), // Only uncategorized fields
      },
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
    return await db.customField.count({
      where: { organizationId, active: true, deletedAt: null },
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

    const updatedFields = await db.customField.updateMany({
      where: { id: { in: customFieldsIds }, organizationId },
      data: { active },
    });

    /** Get the asset index settings for the organization */
    const settings = await db.assetIndexSettings.findMany({
      where: { organizationId },
    });

    /** Update the asset index settings for each entry */
    const updates = settings.map((entry) => {
      const columns = Array.from(entry.columns as Prisma.JsonArray) as Column[];

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

      return db.assetIndexSettings.update({
        where: { id: entry.id, organizationId },
        data: { columns },
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
