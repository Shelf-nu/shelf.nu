import type { Category, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database";
import { getRandomColor } from "~/utils";
import { handleUniqueConstraintError } from "~/utils/error";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

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
    const category = await db.category.create({
      data: {
        name,
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
    return { category, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Category");
  }
}

export async function getCategories({
  organizationId,
  page = 1,
  perPage = 8,
  search,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page?: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the items belonging to current user */
  let where: Prisma.CategoryWhereInput = { organizationId };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [categories, totalCategories] = await db.$transaction([
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
}

export async function deleteCategory({
  id,
  organizationId,
}: Pick<Category, "id"> & { organizationId: Organization["id"] }) {
  return db.category.deleteMany({
    where: { id, organizationId },
  });
}

export async function getAllCategories({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  return await db.category.findMany({ where: { organizationId } });
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
  // first we get all the categories from the assets and make then into an object where the category is the key and the value is an empty string
  const categories = new Map(
    data
      .filter((asset) => asset.category !== "")
      .map((asset) => [asset.category, ""])
  );

  // now we loop through the categories and check if they exist
  for (const [category, _] of categories) {
    const existingCategory = await db.category.findFirst({
      where: { name: category, organizationId },
    });

    if (!existingCategory) {
      // if the category doesn't exist, we create a new one
      const newCategory = await db.category.create({
        data: {
          name: (category as string).trim(),
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
}
export async function getCategory({ id }: Pick<Category, "id">) {
  return db.category.findUnique({
    where: {
      id,
    },
  });
}

export async function updateCategory({
  id,
  name,
  description,
  color,
}: Pick<Category, "id" | "description" | "name" | "color">) {
  try {
    const category = await db.category.update({
      where: {
        id,
      },
      data: {
        name,
        description,
        color,
      },
    });
    return { category, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Category");
  }
}
