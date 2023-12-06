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
  Booking,
} from "@prisma/client";
import { AssetStatus, BookingStatus, ErrorCorrection } from "@prisma/client";
import { type LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import { getSupabaseAdmin } from "~/integrations/supabase";
import {
  dateTimeInUnix,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  oneDayFromNow,
} from "~/utils";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import {
  buildCustomFieldValue,
  getDefinitionFromCsvHeader,
} from "~/utils/custom-fields";
import { ShelfStackError, handleUniqueConstraintError } from "~/utils/error";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type {
  CreateAssetFromBackupImportPayload,
  CreateAssetFromContentImportPayload,
  ShelfAssetCustomFieldValueType,
  UpdateAssetPayload,
} from "./types";
import { createCategoriesIfNotExists, getAllCategories } from "../category";
import {
  createCustomFieldsIfNotExists,
  upsertCustomField,
} from "../custom-field";
import type { CustomFieldDraftPayload } from "../custom-field/types";
import { createLocationsIfNotExists } from "../location";
import { getQr } from "../qr";
import { createTagsIfNotExists, getAllTags } from "../tag";
import { createTeamMemberIfNotExists } from "../team-member";

export async function getAsset({
  organizationId,
  userId,
  id,
}: Pick<Asset, "id"> & {
  organizationId?: Organization["id"];
  userId?: User["id"];
}) {
  const asset = await db.asset.findFirst({
    where: { id, organizationId, userId },
    include: {
      category: true,
      notes: {
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
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
      organization: {
        select: {
          currency: true,
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
  organizationId,
  page = 1,
  perPage = 8,
  search,
  categoriesIds,
  tagsIds,
  bookingFrom,
  bookingTo,
  hideUnavailable,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;

  categoriesIds?: Category["id"][] | null;
  tagsIds?: Tag["id"][] | null;
  hideUnavailable?: Asset["availableToBook"];
  bookingFrom?: Booking["from"];
  bookingTo?: Booking["to"];
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.AssetSearchViewWhereInput = { asset: { organizationId } };

  /** If the search string exists, add it to the where object */
  if (search) {
    const words = search
      .trim()
      .replace(/ +/g, " ") //replace multiple spaces into 1
      .split(" ")
      .map((w) => w.replace(/[^a-zA-Z0-9\-_]/g, "") + ":*") //remove uncommon special character
      .filter(Boolean)
      .join(" & ");
    where.searchVector = {
      search: words,
    };
  }

  if (categoriesIds && categoriesIds.length > 0 && where.asset) {
    if (categoriesIds.includes("uncategorized")) {
      where.asset.OR = [
        {
          categoryId: {
            in: categoriesIds,
          },
        },
        {
          categoryId: null,
        },
      ];
    } else {
      where.asset.categoryId = {
        in: categoriesIds,
      };
    }
  }
  const unavailableBookingStatuses = [
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
    BookingStatus.ONGOING,
  ];
  if (hideUnavailable && where.asset) {
    //not disabled for booking
    where.asset.availableToBook = true;
    //not assigned to team meber
    where.asset.custody = null;
    if (bookingFrom && bookingTo) {
      //reserved during that time
      where.asset.bookings = {
        none: {
          status: { in: unavailableBookingStatuses },
          OR: [
            {
              from: { lte: bookingTo },
              to: { gte: bookingFrom },
            },
            {
              from: { gte: bookingFrom },
              to: { lte: bookingTo },
            },
          ],
        },
      };
    }
  }
  if (hideUnavailable === false && (!bookingFrom || !bookingTo)) {
    throw new ShelfStackError({
      message: "booking dates are needed to hide unavailable assets",
    });
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
                    user: {
                      select: {
                        profilePicture: true,
                      },
                    },
                  },
                },
              },
            },
            ...(hideUnavailable === false
              ? {
                  bookings: {
                    where: {
                      status: { in: unavailableBookingStatuses },
                      ...(bookingTo &&
                        bookingFrom && {
                          OR: [
                            {
                              from: { lte: bookingTo },
                              to: { gte: bookingFrom },
                            },
                            {
                              from: { gte: bookingFrom },
                              to: { lte: bookingTo },
                            },
                          ],
                        }),
                    },
                    take: 1, //just to show in UI if its booked, so take only 1
                    select: {
                      from: true,
                      to: true,
                      status: true,
                      id: true,
                    }, //@TODO more needed?
                  },
                }
              : {}),
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
  organizationId,
  valuation,
}: Pick<
  Asset,
  "description" | "title" | "categoryId" | "userId" | "valuation"
> & {
  qrId?: Qr["id"];
  locationId?: Location["id"];
  tags?: { set: { id: string }[] };
  custodian?: TeamMember["id"];
  customFieldsValues?: ShelfAssetCustomFieldValueType[];
  organizationId: Organization["id"];
}) {
  try {
    /** User connction data */
    const user = {
      connect: {
        id: userId,
      },
    };

    const organization = {
      connect: {
        id: organizationId as string,
      },
    };

    /**
     * If a qr code is passsed, link to that QR
     * Otherwise, create a new one
     * Here we also need to double check:
     * 1. If the qr code exists
     * 2. If the qr code belongs to the current organization
     * 3. If the qr code is not linked to an asset
     */
    const qr = qrId ? await getQr(qrId) : null;
    const qrCodes =
      qr && qr.organizationId === organizationId && qr.assetId === null
        ? { connect: { id: qrId } }
        : {
            create: [
              {
                version: 0,
                errorCorrection: ErrorCorrection["L"],
                user,
                organization,
              },
            ],
          };

    /** Data object we send via prisma to create Asset */
    const data = {
      title,
      description,
      user,
      qrCodes,
      valuation,
      organization,
    };

    /** If a categoryId is passed, link the category to the asset. */
    if (categoryId && categoryId !== "uncategorized") {
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
            ({ id, value }) =>
              id &&
              value && {
                value,
                customFieldId: id,
              }
          ),
        },
      });
    }

    const asset = await db.asset.create({
      data,
      include: {
        location: true,
        user: true,
        custody: true,
      },
    });
    return { asset, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Asset");
  }
}

export async function updateAsset(payload: UpdateAssetPayload) {
  try {
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
      valuation,
      customFieldsValues: customFieldsValuesFromForm,
    } = payload;
    const isChangingLocation = newLocationId !== currentLocationId;

    const data = {
      title,
      description,
      valuation,
      mainImage,
      mainImageExpiration,
    };

    /** If uncategorized is passed, disconnect the category */
    if (categoryId === "uncategorized") {
      Object.assign(data, {
        category: {
          disconnect: true,
        },
      });
    }

    // If category id is passed and is differenent than uncategorized, connect the category
    if (categoryId && categoryId !== "uncategorized") {
      Object.assign(data, {
        category: {
          connect: {
            id: categoryId,
          },
        },
      });
    }

    /** Connect the new location id */
    if (newLocationId) {
      Object.assign(data, {
        location: {
          connect: {
            id: newLocationId,
          },
        },
      });
    }

    /** disconnecting location relation if a user clears locations */
    if (currentLocationId && !newLocationId) {
      Object.assign(data, {
        location: {
          disconnect: true,
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
      const currentCustomFieldsValues = await db.assetCustomFieldValue.findMany(
        {
          where: {
            assetId: id,
          },
          select: {
            id: true,
            customFieldId: true,
          },
        }
      );

      Object.assign(data, {
        customFields: {
          upsert: customFieldsValuesFromForm?.map(({ id, value }) => ({
            where: {
              id:
                currentCustomFieldsValues.find(
                  (ccfv) => ccfv.customFieldId === id
                )?.id || "",
            },
            update: { value },
            create: {
              value,
              customFieldId: id,
            },
          })),
        },
      });
    }

    const asset = await db.asset.update({
      where: { id },
      data,
      include: { location: true, tags: true },
    });

    /** If the location id was passed, we create a note for the move */
    if (isChangingLocation) {
      /**
       * Create a note for the move
       * Here we actually need to query the locations so we can print their names
       * */

      const user = await db.user.findFirst({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      });

      const currentLocation = currentLocationId
        ? await db.location.findFirst({
            where: {
              id: currentLocationId,
            },
          })
        : null;

      const newLocation = newLocationId
        ? await db.location.findFirst({
            where: {
              id: newLocationId,
            },
          })
        : null;

      await createLocationChangeNote({
        currentLocation,
        newLocation,
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        assetName: asset?.title,
        assetId: asset.id,
        userId,
        isRemoving: newLocationId === null,
      });
    }

    return { asset, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Asset");
  }
}

export async function deleteAsset({
  id,
  organizationId,
}: Pick<Asset, "id"> & { organizationId: Organization["id"] }) {
  return db.asset.deleteMany({
    where: { id, organizationId },
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

async function uploadDuplicateAssetMainImage(
  mainImageUrl: string,
  assetId: string,
  userId: string
) {
  /**
   * Getting the blob from asset mainImage signed url so
   * that we can upload it into duplicated assets as well
   * */
  const imageFile = await fetch(mainImageUrl);
  const imageFileBlob = await imageFile.blob();

  /** Uploading the Blob to supabase */
  const { data, error } = await getSupabaseAdmin()
    .storage.from("assets")
    .upload(
      `${userId}/${assetId}/main-image-${dateTimeInUnix(Date.now())}`,
      imageFileBlob,
      { contentType: imageFileBlob.type, upsert: true }
    );

  if (!data?.path || error) {
    throw new ShelfStackError({
      message: "Could not upload image fot the asset!",
      status: 500,
    });
  }

  /** Getting the signed url from supabase to we can view image  */
  const signedUrl = await createSignedUrl({ filename: data.path });
  return signedUrl;
}

export async function duplicateAsset({
  asset,
  userId,
  amountOfDuplicates,
  organizationId,
}: {
  asset: Prisma.AssetGetPayload<{
    include: { custody: { include: { custodian: true } }; tags: true };
  }>;
  userId: string;
  amountOfDuplicates: number;
  organizationId: string;
}) {
  const duplicatedAssets = [];

  for (const i of [...Array(amountOfDuplicates)].keys()) {
    const rsp = await createAsset({
      title: `${asset.title} (copy ${
        amountOfDuplicates > 1 ? i : ""
      } ${Date.now()})`,
      organizationId,
      description: asset.description,
      userId,
      categoryId: asset.categoryId,
      locationId: asset.locationId ?? undefined,
      custodian: asset?.custody?.custodian.id ?? undefined,
      tags: { set: asset.tags.map((tag) => ({ id: tag.id })) },
      valuation: asset.valuation,
    });
    // @ts-ignore
    // @TODO fix this. MIght need to modify how handling the error works
    const duplicatedAsset = rsp.asset as Asset;

    if (asset.mainImage) {
      const imagePath = await uploadDuplicateAssetMainImage(
        asset.mainImage,
        duplicatedAsset.id,
        userId
      );

      if (typeof imagePath === "string") {
        await db.asset.update({
          where: { id: duplicatedAsset.id },
          data: {
            mainImage: imagePath,
            mainImageExpiration: oneDayFromNow(),
          },
        });
      }
    }

    duplicatedAssets.push(duplicatedAsset);
  }

  return duplicatedAssets;
}

/** Fetches all related entries required for creating a new asset */
export async function getAllRelatedEntries({
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
    db.category.findMany({ where: { organizationId } }),

    /** Get the tags */
    db.tag.findMany({ where: { organizationId } }),

    /** Get the locations */
    db.location.findMany({ where: { organizationId } }),

    /** Get the custom fields */
    db.customField.findMany({
      where: { organizationId, active: { equals: true } },
    }),
  ]);
  return { categories, tags, locations, customFields };
}

export const getPaginatedAndFilterableAssets = async ({
  request,
  organizationId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  extraInclude?: Prisma.AssetInclude;
}) => {
  const searchParams = getCurrentSearchParams(request);
  const {
    page,
    perPageParam,
    search,
    categoriesIds,
    tagsIds,
    bookingFrom,
    bookingTo,
    hideUnavailable,
  } = getParamsValues(searchParams);

  const { prev, next } = generatePageMeta(request);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const categories = await getAllCategories({
    organizationId,
  });

  const tags = await getAllTags({
    organizationId,
  });

  const { assets, totalAssets } = await getAssets({
    organizationId,
    page,
    perPage,
    search,
    categoriesIds,
    tagsIds,
    bookingFrom,
    bookingTo,
    hideUnavailable,
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
  newLocation: Location | null;
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

  let message = "";
  if (currentLocation && newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** updated the location of **${assetName.trim()}** from **${currentLocation.name.trim()}** to **${newLocation.name.trim()}**`; // updating location
  }

  if (newLocation && !currentLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** set the location of **${assetName.trim()}** to **${newLocation.name.trim()}**`; // setting to first location
  }

  if (isRemoving || !newLocation) {
    message = `**${firstName.trim()} ${lastName.trim()}** removed  **${assetName.trim()}** from location **${currentLocation?.name.trim()}**`; // removing location
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
  organizationId,
}: {
  organizationId: Organization["id"];
}) =>
  await db.asset.findMany({
    where: {
      organizationId,
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
    organizationId,
  });

  const locations = await createLocationsIfNotExists({
    data,
    userId,
    organizationId,
  });

  const teamMembers = await createTeamMemberIfNotExists({
    data,
    organizationId,
  });

  const tags = await createTagsIfNotExists({
    data,
    userId,
    organizationId,
  });

  const customFields = await createCustomFieldsIfNotExists({
    data,
    organizationId,
    userId,
  });

  for (const asset of data) {
    const customFieldsValues: ShelfAssetCustomFieldValueType[] = Object.entries(
      asset
    ).reduce((res, [key, val]) => {
      if (key.startsWith("cf:") && val) {
        const { name } = getDefinitionFromCsvHeader(key);
        if (customFields[name].id) {
          res.push({
            id: customFields[name].id,
            value: buildCustomFieldValue(
              { raw: asset[key] },
              customFields[name]
            ),
          } as ShelfAssetCustomFieldValueType);
        }
      }
      return res;
    }, [] as ShelfAssetCustomFieldValueType[]);

    await createAsset({
      organizationId,
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
      valuation: asset.valuation ? +asset.valuation : null,
      customFieldsValues,
    });
  }
};

export const createAssetsFromBackupImport = async ({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromBackupImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) => {
  //TODO use concurrency control or it will overload the server
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
              organizationId,
            },
          ],
        },
        valuation: asset.valuation ? +asset.valuation : null,
      },
    };

    /** Category */
    if (asset.category && Object.keys(asset?.category).length > 0) {
      const category = asset.category as Category;

      const existingCat = await db.category.findFirst({
        where: {
          organizationId,
          name: category.name,
        },
      });

      /** If it doesnt exist, create a new one */
      if (!existingCat) {
        const newCat = await db.category.create({
          data: {
            organizationId,
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
          organizationId,
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
            organizationId,
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
          deletedAt: null,
          organizationId,
          name: custodian.name,
        },
      });

      if (!existingCustodian) {
        const newCustodian = await db.teamMember.create({
          data: {
            name: custodian.name,
            organizationId,
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
            organizationId,
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
              organization: {
                connect: {
                  id: organizationId,
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
      const customFieldDef = asset.customFields.reduce(
        (res, { value, customField }) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, createdAt, updatedAt, ...rest } = customField;
          const options = value?.valueOption?.length
            ? [value?.valueOption]
            : undefined;
          res.push({ ...rest, options, userId, organizationId });
          return res;
        },
        [] as Array<CustomFieldDraftPayload>
      );

      const cfIds = await upsertCustomField(customFieldDef);

      Object.assign(d.data, {
        customFields: {
          create: asset.customFields.map((cf) => ({
            value: cf.value,
            customFieldId: cfIds[cf.customField.name].id,
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
