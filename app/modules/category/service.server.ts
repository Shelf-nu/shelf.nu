import type { Category, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";

import type { ErrorLabel } from "~/utils/error";
import { ShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
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

    /** Default value of where. Takes the items belonging to current user */
    const where: Prisma.CategoryWhereInput = { organizationId };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

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
        .filter((asset) => asset.category !== "")
        .map((asset) => [asset.category, ""])
    );

    // Handle the case where there are no categories
    if (categories.has(undefined)) {
      return {};
    }

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

export async function bulkDeleteCategories({
  categoryIds,
  organizationId,
}: {
  categoryIds: Category["id"][];
  organizationId: Organization["id"];
}) {
  try {
    return await db.category.deleteMany({
      where: categoryIds.includes(ALL_SELECTED_KEY)
        ? { organizationId }
        : { id: { in: categoryIds }, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting categories.",
      additionalData: { categoryIds, organizationId },
      label,
    });
  }
}
