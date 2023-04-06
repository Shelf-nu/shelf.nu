import type { Category, Prisma, User } from "@prisma/client";
import { db } from "~/database";

export async function createCategory({
  name,
  description,
  color,
  userId,
}: Pick<Category, "description" | "name" | "color"> & {
  userId: User["id"];
}) {
  return db.category.create({
    data: {
      name,
      description,
      color,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

export async function getCategories({
  userId,
  page = 1,
  perPage = 8,
  search,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page?: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the items belonging to current user */
  let where: Prisma.ItemWhereInput = { userId };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.title = {
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
    }),

    /** Count them */
    db.category.count({ where }),
  ]);

  return { categories, totalCategories };
}

export async function deleteCategory({
  id,
  userId,
}: Pick<Category, "id"> & { userId: User["id"] }) {
  return db.category.deleteMany({
    where: { id, userId },
  });
}
