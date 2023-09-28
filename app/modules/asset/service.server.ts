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
  CustomField,
  AssetCustomFieldValue,
} from "@prisma/client";
import { AssetStatus, ErrorCorrection } from "@prisma/client";
import { type LoaderArgs } from "@remix-run/node";
import { db } from "~/database";
import {
  dateTimeInUnix,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  oneDayFromNow,
} from "~/utils";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { processCustomFields } from "~/utils/import.server";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import { createCategoriesIfNotExists, getAllCategories } from "../category";
import { createCustomFieldsIfNotExists } from "../custom-field";
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
      customFields: {
        where: {
          customField: {
            active: true,
          },
        },
        include: {
          customField: {
            select: {
              id: true,
              name: true,
              helpText: true,
              required: true,
              type: true,
            },
          },
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
  let where: Prisma.AssetSearchViewWhereInput = { asset: { userId } };

  /** If the search string exists, add it to the where object */
  if (search) {
    const words = search
      .split(" ")      
      .map((w) => w.replace(/[^a-zA-Z0-9\-_]/g, "") + ":*")
      .filter(Boolean) //remove uncommon special character
      .join(" & ");
    where.searchVector = {
      search: words,
    };
  }

  if (categoriesIds && categoriesIds.length > 0 && where.asset) {
    where.asset.categoryId = {
      in: categoriesIds,
    };
  }

  if (tagsIds && tagsIds.length > 0 && where.asset) {
    where.asset.tags = {
      some: {
        id: {
          in: tagsIds,
        },
      },
    };
  }

  const [assetSearch, totalAssets] = await db.$transaction([
    /** Get the assets */
    db.assetSearchView.findMany({
      skip,
      take,
      where,
      include: {
        asset: {
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
        },
      },
      orderBy: { createdAt: "desc" },
    }),

    /** Count them */
    db.assetSearchView.count({ where }),
  ]);

  return { assets: assetSearch.map((a) => a.asset), totalAssets };
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
  customFieldsValues,
}: Pick<Asset, "description" | "title" | "categoryId" | "userId"> & {
  qrId?: Qr["id"];
  locationId?: Location["id"];
  tags?: { set: { id: string }[] };
  custodian?: TeamMember["id"];
  customFieldsValues?: ({ id: string; value: string | undefined } | null)[];
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

  /** If custom fields are passed, create them */
  if (customFieldsValues && customFieldsValues.length > 0) {
    Object.assign(data, {
      /** Custom fields here refers to the values, check the Schema for more info */
      customFields: {
        create: customFieldsValues?.map(
          (cf: { id: string; value: string | undefined } | null) =>
            cf !== null && {
              value: cf?.value || "",
              customFieldId: cf.id,
            }
        ),
      },
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
  customFieldsValues?: { id: string; value: string | undefined }[];
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
    customFieldsValues: customFieldsValuesFromForm,
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

  /** If custom fields are passed, create/update them */
  if (customFieldsValuesFromForm && customFieldsValuesFromForm.length > 0) {
    /** We get the current values. We need this in order to co-relate the correct fields to update as we dont have the id's of the values */
    const currentCustomFieldsValues = await db.assetCustomFieldValue.findMany({
      where: {
        assetId: id,
      },
      select: {
        id: true,
        customFieldId: true,
      },
    });

    Object.assign(data, {
      customFields: {
        upsert: customFieldsValuesFromForm?.map(
          (cf: { id: string; value: string | undefined }) => ({
            where: {
              id:
                currentCustomFieldsValues.find(
                  (ccfv) => ccfv.customFieldId === cf.id
                )?.id || "",
            },
            update: {
              value: cf?.value || "",
            },
            create: {
              value: cf?.value || "",
              customFieldId: cf.id,
            },
          })
        ),
      },
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
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<{
  categories: Category[];
  tags: Tag[];
  locations: Location[];
  customFields: CustomField[];
}> {
  const [categories, tags, locations, customFields] = await db.$transaction([
    /** Get the categories */
    db.category.findMany({ where: { userId } }),

    /** Get the tags */
    db.tag.findMany({ where: { userId } }),

    /** Get the locations */
    db.location.findMany({ where: { userId } }),

    /** Get the custom fields */
    db.customField.findMany({
      where: { organizationId, active: { equals: true } },
    }),
  ]);
  return { categories, tags, locations, customFields };
}

export const getPaginatedAndFilterableAssets = async ({
  request,
  userId,
}: {
  request: LoaderArgs["request"];
  userId: User["id"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search, categoriesIds, tagsIds } =
    getParamsValues(searchParams);

  const { prev, next } = generatePageMeta(request);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

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
    cookie,
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
      category: true,
      location: true,
      notes: true,
      custody: {
        include: {
          custodian: true,
        },
      },
      tags: true,
      customFields: {
        include: {
          customField: true,
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

  const customFields = await createCustomFieldsIfNotExists({
    data,
    organizationId,
    userId,
  });

  for (const asset of data) {
    const assetCustomFieldsValues = Object.entries(asset)
      .map(([key, value]) => (key.startsWith("cf:") ? value : null))
      .filter((v) => v !== null);

    await createAsset({
      title: asset.title,
      description: asset.description || "",
      userId,
      categoryId: asset.category ? categories[asset.category] : null,
      locationId: asset.location ? locations[asset.location] : undefined,
      custodian: asset.custodian ? teamMembers[asset.custodian] : undefined,
      tags:
        asset.tags.length > 0
          ? {
              set: asset.tags
                .filter((t) => tags[t])
                .map((t) => ({ id: tags[t] })),
            }
          : undefined,
      customFieldsValues:
        assetCustomFieldsValues?.length > 0
          ? assetCustomFieldsValues
              .map((v: string) =>
                customFields[v]?.id
                  ? {
                      id: customFields[v].id,
                      value: v || "",
                    }
                  : null
              )
              .filter((v) => v !== null)
          : undefined,
    });
  }
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

export const createAssetsFromBackupImport = async ({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromBackupImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) => {
  // console.log(data);

  data.map(async (asset) => {
    /** Base data from asset */
    const d = {
      data: {
        title: asset.title,
        description: asset.description || null,
        mainImage: asset.mainImage || null,
        mainImageExpiration: oneDayFromNow(),
        userId,
        organizationId,
        status: asset.status,
        createdAt: new Date(asset.createdAt),
        updatedAt: new Date(asset.updatedAt),
        qrCodes: {
          create: [
            {
              version: 0,
              errorCorrection: ErrorCorrection["L"],
              userId,
            },
          ],
        },
      },
    };

    /** Category */
    if (asset.category && Object.keys(asset?.category).length > 0) {
      const category = asset.category as Category;

      const existingCat = await db.category.findFirst({
        where: {
          userId,
          name: category.name,
        },
      });

      /** If it doesnt exist, create a new one */
      if (!existingCat) {
        const newCat = await db.category.create({
          data: {
            name: category.name,
            description: category.description || "",
            color: category.color,
            userId,
            createdAt: new Date(category.createdAt),
            updatedAt: new Date(category.updatedAt),
          },
        });
        /** Add it to the data for creating the asset */
        Object.assign(d.data, {
          categoryId: newCat.id,
        });
      } else {
        /** Add it to the data for creating the asset */
        Object.assign(d.data, {
          categoryId: existingCat.id,
        });
      }
    }

    /** Location */
    if (asset.location && Object.keys(asset?.location).length > 0) {
      const location = asset.location as Location;

      const existingLoc = await db.location.findFirst({
        where: {
          userId,
          name: location.name,
        },
      });

      /** If it doesnt exist, create a new one */
      if (!existingLoc) {
        const newLoc = await db.location.create({
          data: {
            name: location.name,
            description: location.description || "",
            address: location.address || "",
            userId,
            createdAt: new Date(location.createdAt),
            updatedAt: new Date(location.updatedAt),
          },
        });
        /** Add it to the data for creating the asset */
        Object.assign(d.data, {
          locationId: newLoc.id,
        });
      } else {
        /** Add it to the data for creating the asset */
        Object.assign(d.data, {
          locationId: existingLoc.id,
        });
      }
    }

    /** Custody */
    if (asset.custody && Object.keys(asset?.custody).length > 0) {
      const { custodian } = asset.custody;

      const existingCustodian = await db.teamMember.findFirst({
        where: {
          organizations: {
            some: {
              id: organizationId,
            },
          },
          name: custodian.name,
        },
      });

      if (!existingCustodian) {
        const newCustodian = await db.teamMember.create({
          data: {
            name: custodian.name,
            organizations: {
              connect: {
                id: organizationId,
              },
            },
            createdAt: new Date(custodian.createdAt),
            updatedAt: new Date(custodian.updatedAt),
          },
        });

        Object.assign(d.data, {
          custody: {
            create: {
              teamMemberId: newCustodian.id,
            },
          },
        });
      } else {
        Object.assign(d.data, {
          custody: {
            create: {
              teamMemberId: existingCustodian.id,
            },
          },
        });
      }
    }

    /** Tags */
    if (asset.tags && asset.tags.length > 0) {
      const tagsNames = asset.tags.map((t) => t.name);
      // now we loop through the categories and check if they exist
      let tags: Record<string, string> = {};
      for (const tag of tagsNames) {
        const existingTag = await db.tag.findFirst({
          where: {
            name: tag,
            userId,
          },
        });

        if (!existingTag) {
          // if the tag doesn't exist, we create a new one
          const newTag = await db.tag.create({
            data: {
              name: tag as string,
              user: {
                connect: {
                  id: userId,
                },
              },
            },
          });
          tags[tag] = newTag.id;
        } else {
          // if the tag exists, we just update the id
          tags[tag] = existingTag.id;
        }
      }

      Object.assign(d.data, {
        tags:
          asset.tags.length > 0
            ? {
                connect: asset.tags.map((tag) => ({ id: tags[tag.name] })),
              }
            : undefined,
      });
    }

    /** Custom fields */
    if (asset.customFields && asset.customFields.length > 0) {
      /** we need to check if custom fields exist and create them
       * Then we need to also create the values for the asset.customFields
       */

      const cfIds = await processCustomFields({
        asset,
        organizationId,
        userId,
      });

      Object.assign(d.data, {
        customFields: {
          create: asset.customFields.map((cf) => ({
            value: cf.value,
            customFieldId: cfIds[cf.customField.name],
          })),
        },
      });
    }

    /** Create the Asset */
    const { id: assetId } = await db.asset.create(d);

    /** Create notes */
    if (asset?.notes?.length > 0) {
      await db.note.createMany({
        data: asset.notes.map((note: Note) => ({
          content: note.content,
          type: note.type,
          assetId,
          userId,
          createdAt: new Date(note.createdAt),
          updatedAt: new Date(note.updatedAt),
        })),
      });
    }
  });
};

export interface CreateAssetFromBackupImportPayload
  extends Record<string, any> {
  id: string;
  title: string;
  description?: string;
  category:
    | {
        id: string;
        name: string;
        description: string;
        color: string;
        createdAt: string;
        updatedAt: string;
        userId: string;
      }
    | {};
  tags: {
    name: string;
  }[];
  location:
    | {
        name: string;
        description?: string;
        address?: string;
        createdAt: string;
        updatedAt: string;
      }
    | {};
  customFields: AssetCustomFieldsValuesWithFields[];
}

export type AssetCustomFieldsValuesWithFields = AssetCustomFieldValue & {
  customField: CustomField;
};
