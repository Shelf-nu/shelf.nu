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
  per_page = 2,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  per_page?: number;
}) {
  return db.item.findMany({
    skip: page > 1 ? (page - 1) * per_page : 0,
    take: per_page,
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
