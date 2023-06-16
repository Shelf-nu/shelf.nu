import type {
  Category,
  Note,
  Prisma,
  Qr,
  Asset,
  User,
  Tag,
} from "@prisma/client";
import { ErrorCorrection } from "@prisma/client";
import { db } from "~/database";
import { dateTimeInUnix, oneDayFromNow } from "~/utils";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import { getQr } from "../qr";

export async function getAsset({
  userId,
  id,
}: Pick<Asset, "id"> & {
  userId: User["id"];
}) {
  return db.asset.findFirst({
    where: { id, userId },
    include: {
      category: true,
      notes: {
        orderBy: { createdAt: "desc" },
      },
      qrCodes: true,
      tags: true,
    },
  });
}

export async function getAssets({
  userId,
  page = 1,
  perPage = 8,
  search,
  categoriesIds,
  tagsIds,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;

  categoriesIds?: Category["id"][] | null;
  tagsIds?: Tag["id"][] | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.AssetWhereInput = { userId };

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

  if (tagsIds && tagsIds.length > 0) {
    where.tags = {
      some: {
        id: {
          in: tagsIds,
        },
      },
    };
  }

  const [assets, totalAssets] = await db.$transaction([
    /** Get the assets */
    db.asset.findMany({
      skip,
      take,
      where,
      include: { category: true, tags: true },
      orderBy: { createdAt: "desc" },
    }),

    /** Count them */
    db.asset.count({ where }),
  ]);

  return { assets, totalAssets };
}

export async function createAsset({
  title,
  description,
  userId,
  categoryId,
  qrId,
  tags,
}: Pick<Asset, "description" | "title" | "categoryId"> & {
  userId: User["id"];
  qrId?: Qr["id"];
  tags?: { set: { id: string }[] };
}) {
  /** User connction data */
  const user = {
    connect: {
      id: userId,
    },
  };

  /**
   * If a qr code is passsed, link to that QR
   * Otherwise, create a new one
   * Here we also need to double check:
   * 1. If the qr code exists
   * 2. If the qr code belongs to the current user
   * 3. If the qr code is not linked to an asset
   */
  const qr = qrId ? await getQr(qrId) : null;
  const qrCodes =
    qr && qr.userId === userId && qr.assetId === null
      ? { connect: { id: qrId } }
      : {
          create: [
            {
              version: 0,
              errorCorrection: ErrorCorrection["L"],
              user,
            },
          ],
        };

  /** Data object we send via prisma to create Asset */
  const data = {
    title,
    description,
    user,
    qrCodes,
  };

  /** If a categoryId is passed, link the category to the asset. */
  if (categoryId) {
    Object.assign(data, {
      category: {
        connect: {
          id: categoryId,
        },
      },
    });
  }

  /** If a categoryId is passed, link the category to the asset. */
  if (tags && tags?.set?.length > 0) {
    Object.assign(data, {
      tags: {
        connect: tags?.set,
      },
    });
  }

  return db.asset.create({
    data,
  });
}

interface UpdateAssetPayload {
  id: Asset["id"];
  title?: Asset["title"];
  description?: Asset["description"];
  categoryId?: Asset["categoryId"];
  mainImage?: Asset["mainImage"];
  mainImageExpiration?: Asset["mainImageExpiration"];
  tags?: { set: { id: string }[] };
}

export async function updateAsset(payload: UpdateAssetPayload) {
  const { categoryId, id } = payload;
  /** Delete the category id from the payload so we can use connect syntax from prisma */
  delete payload.categoryId;

  if (categoryId) {
    Object.assign(payload, {
      category: {
        connect: {
          id: categoryId,
        },
      },
    });
  }

  return db.asset.update({
    where: { id },
    data: payload,
  });
}

export async function deleteAsset({
  id,
  userId,
}: Pick<Asset, "id"> & { userId: User["id"] }) {
  return db.asset.deleteMany({
    where: { id, userId },
  });
}

export async function updateAssetMainImage({
  request,
  assetId,
  userId,
}: {
  request: Request;
  assetId: string;
  userId: User["id"];
}) {
  const fileData = await parseFileFormData({
    request,
    bucketName: "assets",
    newFileName: `${userId}/${assetId}/main-image-${dateTimeInUnix(
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

  return await updateAsset({
    id: assetId,
    mainImage: signedUrl,
    mainImageExpiration: oneDayFromNow(),
  });
}

export async function createNote({
  content,
  userId,
  assetId,
}: Pick<Note, "content"> & {
  userId: User["id"];
  assetId: Asset["id"];
}) {
  const data = {
    content,
    user: {
      connect: {
        id: userId,
      },
    },
    asset: {
      connect: {
        id: assetId,
      },
    },
  };

  return db.note.create({
    data,
  });
}

export async function deleteNote({
  id,
  userId,
}: Pick<Note, "id"> & { userId: User["id"] }) {
  return db.note.deleteMany({
    where: { id, userId },
  });
}
