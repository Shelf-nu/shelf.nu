import type { Category, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";

import {
  assertBulkDeleteConfirmed,
  assertDeleteConfirmedFor,
} from "~/utils/delete-confirmation.server";
import type { ErrorLabel } from "~/utils/error";
import {
  isNotFoundError,
  ShelfError,
  maybeUniqueConstraintViolation,
  rethrowIfClientError,
} from "~/utils/error";
import { getRandomColor } from "~/utils/get-random-color";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Category";

export async function createCategory({
  name,
  description,
  color,
  userId,
  organizationId,
}: Pick<Category, "description" | "name" | "color" | "organizationId"> & {
  userId: User["id"];
}) {
  try {
    return await db.category.create({
      data: {
        name: name.trim(),
        description,
        color,
        user: {
          connect: {
            id: userId,
          },
        },
        organization: {
          connect: {
            id: organizationId,
          },
        },
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Category", {
      additionalData: { userId, organizationId },
    });
  }
}

/**
 * Builds the categories index where-clause for the active search.
 *
 * Shared by {@link getCategories}, which renders the list, and
 * {@link bulkDeleteCategories}, which expands a "select all" over it. They must
 * agree: the delete is permanent, so any difference removes categories the
 * user never saw.
 *
 * @param params.organizationId - The caller's organization
 * @param params.search - The list's search term (the `s` param)
 * @returns A `Prisma.CategoryWhereInput` scoped to the org and search
 */
function getCategoriesWhereInput({
  organizationId,
  search,
}: {
  organizationId: Organization["id"];
  search?: string | null;
}): Prisma.CategoryWhereInput {
  const where: Prisma.CategoryWhereInput = { organizationId };

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  return where;
}

export async function getCategories(params: {
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

    const where = getCategoriesWhereInput({ organizationId, search });

    const [categories, totalCategories] = await Promise.all([
      /** Get the items */
      db.category.findMany({
        skip,
        take,
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { assets: true },
          },
        },
      }),

      /** Count them */
      db.category.count({ where }),
    ]);

    return { categories, totalCategories };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the categories",
      additionalData: { ...params },
      label,
    });
  }
}

/** What uses a category: everything a delete would change. */
export type CategoryUsage = {
  assets: number;
  kits: number;
  customFields: number;
  assetModelDefaults: number;
};

/**
 * Reads a category's name and what uses it, for the delete dialog and the
 * delete action. Counted for the one category being deleted, on demand, so the
 * categories index never pays for it.
 *
 * @param params.id - The category
 * @param params.organizationId - The caller's organization
 * @returns The name and usage counts, or null when the category is not found
 * @throws {ShelfError} If the lookup fails
 */
export async function getCategoryUsage({
  id,
  organizationId,
}: Pick<Category, "id"> & { organizationId: Organization["id"] }): Promise<{
  name: string;
  usage: CategoryUsage;
} | null> {
  try {
    const category = await db.category.findFirst({
      where: { id, organizationId },
      select: {
        name: true,
        _count: {
          select: {
            assets: true,
            kits: true,
            customFields: true,
            assetModelDefaults: true,
          },
        },
      },
    });

    return category ? { name: category.name, usage: category._count } : null;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while checking what uses the category.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

/**
 * Refuses a single category delete unless the user typed its name, when
 * anything uses it. An unused category deletes with one click, and one that is
 * already gone passes so the delete itself reports it.
 *
 * @param params.id - The category to delete
 * @param params.organizationId - The caller's organization
 * @param params.confirmation - What the user typed in the dialog
 * @throws {ShelfError} 400 when the category is in use and the confirmation
 *   does not match
 */
export async function assertCategoryDeleteConfirmed({
  id,
  organizationId,
  confirmation,
}: Pick<Category, "id"> & {
  organizationId: Organization["id"];
  confirmation: string | null | undefined;
}) {
  await assertDeleteConfirmedFor({
    confirmation,
    findName: async () => {
      const found = await getCategoryUsage({ id, organizationId });
      return found && Object.values(found.usage).some((n) => n > 0)
        ? found.name
        : null;
    },
    label,
  });
}

export async function deleteCategory({
  id,
  organizationId,
}: Pick<Category, "id"> & { organizationId: Organization["id"] }) {
  try {
    return await db.category.deleteMany({
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the category. Please try again or contact support.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function createCategoriesIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, Category["id"]>> {
  try {
    // first we get all the categories from the assets and make then into an object where the category is the key and the value is an empty string
    const categories = new Map(
      data
        .filter((asset) => asset.category)
        .map((asset) => [asset.category, ""])
    );

    // now we loop through the categories and check if they exist
    for (const [category, _] of categories) {
      const trimmedCategory = (category as string).trim();
      const existingCategory = await db.category.findFirst({
        where: {
          name: { equals: trimmedCategory, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingCategory) {
        // if the category doesn't exist, we create a new one
        const newCategory = await db.category.create({
          data: {
            name: trimmedCategory,
            color: getRandomColor(),
            user: {
              connect: {
                id: userId,
              },
            },
            organization: {
              connect: {
                id: organizationId,
              },
            },
          },
        });
        categories.set(category, newCategory.id);
      } else {
        // if the category exists, we just update the id
        categories.set(category, existingCategory.id);
      }
    }

    return Object.fromEntries(Array.from(categories));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating categories. Seems like some of the category data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}
export async function getCategory({
  id,
  organizationId,
}: Pick<Category, "id" | "organizationId">) {
  try {
    return await db.category.findFirstOrThrow({
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Category not found",
      message:
        "The category you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id, organizationId },
      label,
      status: 404,
      // Suppress only true Prisma not-found (P2025); let DB / connectivity
      // failures bubble up to Sentry so we can detect real incidents.
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

export async function updateCategory({
  id,
  organizationId,
  name,
  description,
  color,
}: Pick<Category, "id" | "organizationId" | "description" | "name" | "color">) {
  try {
    return await db.category.update({
      where: {
        id,
        organizationId,
      },
      data: {
        name: name?.trim(),
        description,
        color,
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Category", {
      additionalData: { id, organizationId, name },
    });
  }
}

/**
 * Permanently deletes the selected categories. Assets and kits in them keep
 * existing with no category.
 *
 * A "select all" resolves through {@link getCategoriesWhereInput}, so it
 * removes exactly what the index shows for the active search. The ids are read
 * first and the delete is scoped to them, so the count the user confirmed is
 * the count removed.
 *
 * @param params.categoryIds - Selected ids, possibly with ALL_SELECTED_KEY
 * @param params.organizationId - The caller's organization
 * @param params.currentSearchParams - The index's search params at submit time
 * @param params.confirmation - The number the user typed, see
 *   {@link assertBulkDeleteConfirmed}
 * @returns The Prisma batch result
 * @throws {ShelfError} 400 when the confirmation does not match
 */
export async function bulkDeleteCategories({
  categoryIds,
  organizationId,
  currentSearchParams,
  confirmation,
}: {
  categoryIds: Category["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
  confirmation: string | null | undefined;
}) {
  try {
    const categories = await db.category.findMany({
      where: categoryIds.includes(ALL_SELECTED_KEY)
        ? getCategoriesWhereInput({
            organizationId,
            search: new URLSearchParams(currentSearchParams ?? "").get("s"),
          })
        : { id: { in: categoryIds }, organizationId },
      select: { id: true },
    });

    // Before any write: the typed count must be the number about to go.
    assertBulkDeleteConfirmed({
      selectedIds: categoryIds,
      confirmation,
      matchedCount: categories.length,
      noun: { one: "category", many: "categories" },
      label,
    });

    return await db.category.deleteMany({
      where: {
        id: { in: categories.map((category) => category.id) },
        organizationId,
      },
    });
  } catch (cause) {
    // A refused confirmation carries the count to type in its additionalData.
    rethrowIfClientError(cause);

    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting categories.",
      additionalData: { categoryIds, organizationId },
      label,
    });
  }
}
