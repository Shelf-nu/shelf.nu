import type {
  Category,
  Location,
  Note,
  Prisma,
  Qr,
  Asset,
  User,
  Tag,
  Organization,
  TeamMember,
} from "@prisma/client";
import { AssetStatus, ErrorCorrection } from "@prisma/client";
import type { LoaderArgs } from "@remix-run/node";
import { db } from "~/database";
import {
  dateTimeInUnix,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  oneDayFromNow,
} from "~/utils";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import { createCategoriesIfNotExists, getAllCategories } from "../category";
import { createLocationsIfNotExists } from "../location";
import { getQr } from "../qr";
import { createTagsIfNotExists, getAllTags } from "../tag";
import { createTeamMemberIfNotExists } from "../team-member";

export async function getAsset({
  userId,
  id,
}: Pick<Asset, "id"> & {
  userId: User["id"];
}) {
  const asset = await db.asset.findFirst({
    where: { id, userId },
    include: {
      category: true,
      notes: {
        orderBy: { createdAt: "desc" },
      },
      qrCodes: true,
      tags: true,
      location: true,
      custody: {
        select: {
          createdAt: true,
          custodian: true,
        },
      },
    },
  });

  return asset;
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
  const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

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
      include: {
        category: true,
        tags: true,
        location: {
          select: {
            name: true,
          },
        },
        custody: {
          select: {
            custodian: {
              select: {
                name: true,
              },
            },
          },
        },
      },
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
  custodian,
}: Pick<Asset, "description" | "title" | "categoryId" | "userId"> & {
  qrId?: Qr["id"];
  locationId?: Location["id"];
  tags?: { set: { id: string }[] };
  custodian?: TeamMember["id"];
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

  /** If a tags is passed, link the category to the asset. */
  if (tags && tags?.set?.length > 0) {
    Object.assign(data, {
      tags: {
        connect: tags?.set,
      },
    });
  }

  /** If a custodian is passed, create a Custody relation with that asset
   * `custodian` represents the id of a {@link TeamMember}. */
  if (custodian) {
    Object.assign(data, {
      custody: {
        create: {
          custodian: {
            connect: {
              id: custodian,
            },
          },
        },
      },
      status: AssetStatus.IN_CUSTODY,
    });
  }

  return db.asset.create({
    data,
    include: {
      location: true,
      user: true,
      custody: true,
    },
  });
}

interface UpdateAssetPayload {
  id: Asset["id"];
  title?: Asset["title"];
  description?: Asset["description"];
  categoryId?: Asset["categoryId"];
  newLocationId?: Asset["locationId"];
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
    tags,
    id,
    newLocationId,
    currentLocationId,
    userId,
  } = payload;
  const isChangingLocation =
    newLocationId && currentLocationId && newLocationId !== currentLocationId;

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
  if (newLocationId) {
    Object.assign(data, {
      location: {
        connect: {
          id: newLocationId,
        },
      },
    });
  }

  /** If a tags is passed, link the category to the asset. */
  if (tags && tags?.set) {
    Object.assign(data, {
      tags,
    });
  }

  const asset = await db.asset.update({
    where: { id },
    data,
    include: { location: true, tags: true },
  });

  // /** If the location id was passed, we create a note for the move */
  if (isChangingLocation) {
    /**
     * Create a note for the move
     * Here we actually need to query the locations so we can print their names
     * */

    const [currentLocation, newLocation] = await db.$transaction([
      /** Get the items */
      db.location.findFirst({
        where: {
          id: currentLocationId,
          userId,
        },
      }),

      db.location.findFirst({
        where: {
          id: newLocationId,
          userId,
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    ]);

    await createLocationChangeNote({
      currentLocation,
      newLocation: newLocation as Location,
      firstName: newLocation?.user.firstName || "",
      lastName: newLocation?.user.lastName || "",
      assetName: asset?.title,
      assetId: asset.id,
      userId: newLocation?.userId as string,
      isRemoving: false,
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
}: Pick<Note, "content"> & {
  type?: Note["type"];
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

export const getPaginatedAndFilterableAssets = async ({
  request,
  userId,
}: {
  request: LoaderArgs["request"];
  userId: User["id"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search, categoriesIds, tagsIds } =
    getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const categories = await getAllCategories({
    userId,
  });

  const tags = await getAllTags({
    userId,
  });

  const { assets, totalAssets } = await getAssets({
    userId,
    page,
    perPage,
    search,
    categoriesIds,
    tagsIds,
  });
  const totalPages = Math.ceil(totalAssets / perPage);

  return {
    page,
    perPage,
    search,
    totalAssets,
    prev,
    next,
    categories,
    tags,
    assets,
    totalPages,
  };
};

export const createLocationChangeNote = async ({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetName,
  assetId,
  userId,
  isRemoving,
}: {
  currentLocation: Location | null;
  newLocation: Location;
  firstName: string;
  lastName: string;
  assetName: Asset["title"];
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
}) => {
  /**
   * WE have a few cases to handle:
   * 1. Setting the first location
   * 2. Updating the location
   * 3. Removing the location
   */

  let message = currentLocation
    ? `**${firstName} ${lastName}** updated the location of **${assetName}** from **${currentLocation.name}** to **${newLocation.name}**` // updating location
    : `**${firstName} ${lastName}** set the location of **${assetName}** to **${newLocation.name}**`; // setting to first location

  if (isRemoving) {
    message = `**${firstName} ${lastName}** removed  **${assetName}** from location **${currentLocation?.name}**`; // removing location
  }
  await createNote({
    content: message,
    type: "UPDATE",
    userId,
    assetId,
  });
};

/** Fetches assets with the data needed for exporting to CSV */
export const fetchAssetsForExport = async ({
  userId,
}: {
  userId: User["id"];
}) =>
  await db.asset.findMany({
    where: {
      userId,
    },
    include: {
      category: {
        select: {
          name: true,
          description: true,
          color: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      location: {
        select: {
          name: true,
          description: true,
          address: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      notes: {
        select: {
          content: true,
          type: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      custody: {
        select: {
          custodian: {
            select: {
              name: true,
            },
          },
        },
      },
      tags: {
        select: {
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      qrCodes: {
        select: {
          version: true,
          errorCorrection: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

export const createAssetsFromContentImport = async ({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) => {
  const categories = await createCategoriesIfNotExists({
    data,
    userId,
  });

  const locations = await createLocationsIfNotExists({
    data,
    userId,
  });

  const teamMembers = await createTeamMemberIfNotExists({
    data,
    organizationId,
  });

  const tags = await createTagsIfNotExists({
    data,
    userId,
  });

  data.map(async (asset) => {
    console.log("asset.tags", asset.tags);
    console.log("tags", tags);
    console.log("set", { set: asset.tags.map((t) => ({ id: tags[t] })) });
    // const newAssset = await createAsset({
    //   title: asset.title,
    //   description: asset.description || "",
    //   userId,
    //   categoryId: asset.category ? categories[asset.category] : null,
    //   locationId: asset.location ? locations[asset.location] : undefined,
    //   custodian: asset.custodian ? teamMembers[asset.custodian] : undefined,
    //    tags: asset.tags.length > 0 ? { set: asset.tags.map((t) => ({ id: t })) } : undefined,
    // });
    // console.log("newAssset", newAssset);
  });
};

export interface CreateAssetFromContentImportPayload
  extends Record<string, any> {
  title: string;
  description?: string;
  category?: string;
  tags: string[];
  location?: string;
  custodian?: string;
}
