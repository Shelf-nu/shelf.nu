import type { Item, User } from "~/database";
import { db } from "~/database";

export async function getItem({
  userId,
  id,
}: Pick<Item, "id"> & {
  userId: User["id"];
}) {
  return db.item.findFirst({
    where: { id, userId },
  });
}

export async function getItems({
  userId,
  page = 1,
  perPage = 8,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage?: number;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page
  return db.item.findMany({
    skip,
    take,
    where: { userId },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function createItem({
  title,
  description,
  userId,
}: Pick<Item, "description" | "title"> & {
  userId: User["id"];
}) {
  return db.item.create({
    data: {
      title,
      description,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

export async function deleteItem({
  id,
  userId,
}: Pick<Item, "id"> & { userId: User["id"] }) {
  return db.item.deleteMany({
    where: { id, userId },
  });
}

export async function countTotalItems(userId: User["id"]) {
  return db.item.count({
    where: {
      userId,
    },
  });
}
