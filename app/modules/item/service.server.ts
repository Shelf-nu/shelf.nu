import type { Category, Prisma } from "@prisma/client";
import type { Item, User } from "~/database";
import { db } from "~/database";
import { dateTimeInUnix, oneDayFromNow } from "~/utils";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import { requireAuthSession } from "../auth";

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
  search,
  categoriesIds,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;

  categoriesIds?: Category["id"][] | null;
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

  if (categoriesIds && categoriesIds.length > 0) {
    where.categoryId = {
      in: categoriesIds,
    };
  }

  const [items, totalItems] = await db.$transaction([
    /** Get the items */
    db.item.findMany({
      skip,
      take,
      where,
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    }),

    /** Count them */
    db.item.count({ where }),
  ]);

  return { items, totalItems };
}

export async function createItem({
  title,
  description,
  userId,
  categoryId,
}: Pick<Item, "description" | "title" | "categoryId"> & {
  userId: User["id"];
}) {
  const data = {
    title,
    description,
    user: {
      connect: {
        id: userId,
      },
    },
  };

  if (categoryId) {
    Object.assign(data, {
      category: {
        connect: {
          id: categoryId,
        },
      },
    });
  }

  return db.item.create({
    data,
  });
}

interface UpdateItemPayload {
  id: Item["id"];
  title?: Item["title"];
  description?: Item["description"];
  categoryId?: Item["categoryId"];
  mainImage?: Item["mainImage"];
  mainImageExpiration?: Item["mainImageExpiration"];
}

export async function updateItem(payload: UpdateItemPayload) {
  const { id, title, description, categoryId } = payload;
  const data: any = { title, description };

  if (categoryId) {
    Object.assign(data, {
      category: {
        connect: {
          id: categoryId,
        },
      },
    });
  }

  return db.item.update({
    where: { id },
    data,
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

export async function updateItemMainImage({
  request,
  itemId,
}: {
  request: Request;
  itemId: string;
}) {
  const authSession = await requireAuthSession(request);

  const fileData = await parseFileFormData({
    request,
    bucketName: "items",
    newFileName: `${authSession.userId}/${itemId}/main-image-${dateTimeInUnix(
      Date.now()
    )}`,
    resizeOptions: {
      width: 800,
      withoutEnlargement: true,
    },
  });

  const image = fileData.get("mainImage") as string;

  if (!image) return { error: "Couldn't upload image" };

  const signedUrl = await createSignedUrl({ filename: image });

  if (typeof signedUrl !== "string") return signedUrl;

  return await updateItem({
    id: itemId,
    mainImage: signedUrl,
    mainImageExpiration: oneDayFromNow(),
  });
}
