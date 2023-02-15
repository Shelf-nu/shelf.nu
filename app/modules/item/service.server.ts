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

export async function getItems({ userId }: { userId: User["id"] }) {
  return db.item.findMany({
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
