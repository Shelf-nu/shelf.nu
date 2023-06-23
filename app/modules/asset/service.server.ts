import type {
  Category,
  Location,
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
      location: true,
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
  locationId,
  qrId,
  tags,
}: Pick<
  Asset,
  "description" | "title" | "categoryId" | "locationId" | "userId"
> & {
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

  /** If a locationId is passed, link the location to the asset. */
  if (locationId) {
    Object.assign(data, {
      location: {
        connect: {
          id: locationId,
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
  locationId?: Asset["locationId"];
  currentLocationId?: Asset["locationId"];
  mainImage?: Asset["mainImage"];
  mainImageExpiration?: Asset["mainImageExpiration"];
  tags?: { set: { id: string }[] };
  userId?: User["id"];
}

export async function updateAsset(payload: UpdateAssetPayload) {
  const {
    title,
    description,
    mainImage,
    mainImageExpiration,
    categoryId,
    id,
    locationId,
    currentLocationId,
    userId,
  } = payload;
  const isChangingLocation =
    locationId && currentLocationId && locationId !== currentLocationId;

  const data = {
    title,
    description,
    mainImage,
    mainImageExpiration,
  };

  /** Delete the category id from the payload so we can use connect syntax from prisma */
  if (categoryId) {
    Object.assign(data, {
      category: {
        connect: {
          id: categoryId,
        },
      },
    });
  }

  /** Delete the category id from the payload so we can use connect syntax from prisma */
  if (locationId) {
    Object.assign(data, {
      location: {
        connect: {
          id: locationId,
        },
      },
    });
  }

  const asset = await db.asset.update({
    where: { id },
    data,
    include: { location: true },
  });

  // /** If the location id was passed, we create a note for the move */
  if (isChangingLocation) {
    /**
     * Create a note for the move
     * Here we actually need to query the locations so we can print their names
     * */

    const [newLocation, prevLocation] = await db.location.findMany({
      where: {
        id: {
          in: [currentLocationId as string, locationId as string],
        },
        userId,
      },
      select: {
        name: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    await createNote({
      content: `**${newLocation.user.firstName} ${newLocation.user.lastName}** updated the location of **${asset.title}** from **${newLocation.name}** to **${prevLocation.name}**`,
      type: "UPDATE",
      userId: userId as string,
      assetId: id,
    });
  }

  return asset;
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
    userId,
  });
}

export async function createNote({
  content,
  type,
  userId,
  assetId,
}: Pick<Note, "content" | "type"> & {
  userId: User["id"];
  assetId: Asset["id"];
}) {
  const data = {
    content,
    type: type || "COMMENT",
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

/** Fetches all related entries required for creating a new asset */
export async function getAllRelatedEntries({
  userId,
}: {
  userId: User["id"];
}): Promise<{ categories: Category[]; tags: Tag[]; locations: Location[] }> {
  const [categories, tags, locations] = await db.$transaction([
    /** Get the categories */
    db.category.findMany({ where: { userId } }),

    /** Get the tags */
    db.tag.findMany({ where: { userId } }),

    /** Get the locations */
    db.location.findMany({ where: { userId } }),
  ]);
  return { categories, tags, locations };
}
