import type {
  Prisma,
  User,
  Location,
  Organization,
  UserOrganization,
  Asset,
  Kit,
} from "@prisma/client";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { PUBLIC_BUCKET } from "~/utils/constants";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import { geolocate } from "~/utils/geolocate.server";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  getFileUploadPath,
  parseFileFormData,
  removePublicFile,
} from "~/utils/storage.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import {
  getAssetsWhereInput,
  getLocationUpdateNoteContent,
  getKitLocationUpdateNoteContent,
} from "../asset/utils.server";
import { getKitsWhereInput } from "../kit/utils.server";
import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Location";

export async function getLocation(
  params: Pick<Location, "id"> & {
    organizationId: Organization["id"];
    /** Page number. Starts at 1 */
    page?: number;
    /** Assets to be loaded per page with the location */
    perPage?: number;
    search?: string | null;
    orderBy?: string;
    orderDirection?: "asc" | "desc";
    userOrganizations?: Pick<UserOrganization, "organizationId">[];
    request?: Request;
    include?: Prisma.LocationInclude;
  }
) {
  const {
    organizationId,
    id,
    page = 1,
    perPage = 8,
    search,
    userOrganizations,
    request,
    orderBy = "createdAt",
    orderDirection,
    include,
  } = params;

  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Build where object for querying related assets */
    let assetsWhere: Prisma.AssetWhereInput = {};

    if (search) {
      assetsWhere.title = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [location, totalAssetsWithinLocation] = await Promise.all([
      /** Get the items */
      db.location.findFirstOrThrow({
        where: {
          OR: [
            { id, organizationId },
            ...(userOrganizations?.length
              ? [{ id, organizationId: { in: otherOrganizationIds } }]
              : []),
          ],
        },
        include: include
          ? include
          : {
              assets: {
                include: {
                  category: {
                    select: {
                      id: true,
                      name: true,
                      color: true,
                    },
                  },
                  tags: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
                skip,
                take,
                where: assetsWhere,
                orderBy: { [orderBy]: orderDirection },
              },
            },
      }),

      /** Count them */
      db.asset.count({
        where: {
          locationId: id,
        },
      }),
    ]);

    /* User is accessing the location in the wrong organization. In that case we need special 404 handling. */
    if (
      userOrganizations?.length &&
      location.organizationId !== organizationId &&
      otherOrganizationIds?.includes(location.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Location not found.",
        message: "",
        additionalData: {
          model: "location",
          organization: userOrganizations.find(
            (org) => org.organizationId === location.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return { location, totalAssetsWithinLocation };
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Location not found",
      message:
        "The location you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isLikeShelfError(cause) ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function getLocations(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the items belonging to current user */
    let where: Prisma.LocationWhereInput = { organizationId };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [locations, totalLocations] = await Promise.all([
      /** Get the items */
      db.location.findMany({
        skip,
        take,
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { kits: true, assets: true } },
          image: {
            select: {
              updatedAt: true,
            },
          },
        },
      }),

      /** Count them */
      db.location.count({ where }),
    ]);

    return { locations, totalLocations };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the locations",
      additionalData: { ...params },
      label,
    });
  }
}

export async function createLocation({
  name,
  description,
  address,
  userId,
  organizationId,
}: Pick<Location, "description" | "name" | "address"> & {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    // Geocode the address if provided
    let coordinates: { lat: number; lon: number } | null = null;
    if (address) {
      coordinates = await geolocate(address);
    }

    return await db.location.create({
      data: {
        name,
        description,
        address,
        latitude: coordinates?.lat || null,
        longitude: coordinates?.lon || null,
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
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Location", {
      additionalData: { userId, organizationId },
    });
  }
}

export async function deleteLocation({
  id,
  organizationId,
}: Pick<Location, "id" | "organizationId">) {
  try {
    const location = await db.location.delete({
      where: { id, organizationId },
    });

    if (location.imageId) {
      await db.image.delete({
        where: { id: location.imageId },
      });
    }

    return location;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the location",
      additionalData: { id },
      label,
    });
  }
}

export async function updateLocation(payload: {
  id: Location["id"];
  name?: Location["name"];
  address?: Location["address"];
  description?: Location["description"];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  const { id, name, address, description, userId, organizationId } = payload;

  try {
    // Get the current location to check if address changed
    const currentLocation = await db.location.findUniqueOrThrow({
      where: { id, organizationId },
      select: { address: true, latitude: true, longitude: true },
    });

    // Check if address has changed and geocode if necessary
    let coordinates: { lat: number; lon: number } | null = null;
    let shouldUpdateCoordinates = false;

    if (address !== undefined) {
      // address is being updated (could be null or string)
      if (address !== currentLocation.address) {
        shouldUpdateCoordinates = true;
        if (address) {
          coordinates = await geolocate(address);
        }
      }
    }

    return await db.location.update({
      where: { id, organizationId },
      data: {
        name,
        description,
        address,
        ...(shouldUpdateCoordinates && {
          latitude: coordinates?.lat || null,
          longitude: coordinates?.lon || null,
        }),
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Location", {
      additionalData: {
        id,
        userId,
        organizationId,
      },
    });
  }
}

export async function createLocationsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, Location["id"]>> {
  try {
    // first we get all the locations from the assets and make then into an object where the category is the key and the value is an empty string
    const locations = new Map(
      data
        .filter((asset) => asset.location !== "")
        .map((asset) => [asset.location, ""])
    );

    // Handle the case where there are no teamMembers
    if (locations.has(undefined)) {
      return {};
    }

    // now we loop through the locations and check if they exist
    for (const [location, _] of locations) {
      const existingLocation = await db.location.findFirst({
        where: {
          name: { equals: location, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingLocation) {
        // if the location doesn't exist, we create a new one
        const newLocation = await db.location.create({
          data: {
            name: (location as string).trim(),
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
        locations.set(location, newLocation.id);
      } else {
        // if the location exists, we just update the id
        locations.set(location, existingLocation.id);
      }
    }

    return Object.fromEntries(Array.from(locations));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating locations. Seems like some of the location data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function bulkDeleteLocations({
  locationIds,
  organizationId,
}: {
  locationIds: Location["id"][];
  organizationId: Organization["id"];
}) {
  try {
    /** We have to delete the images of locations if any */
    const locations = await db.location.findMany({
      where: locationIds.includes(ALL_SELECTED_KEY)
        ? { organizationId }
        : { id: { in: locationIds }, organizationId },
      select: { id: true, imageId: true },
    });

    return await db.$transaction(async (tx) => {
      /** Deleting all locations */
      await tx.location.deleteMany({
        where: { id: { in: locations.map((location) => location.id) } },
      });

      /** Deleting images of locations */
      const locationWithImages = locations.filter(
        (location) => !!location.imageId
      );
      await tx.image.deleteMany({
        where: {
          id: {
            in: locationWithImages.map((location) => {
              invariant(location.imageId, "Image not found to delete");
              return location.imageId;
            }),
          },
        },
      });
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting locations.",
      additionalData: { locationIds, organizationId },
      label,
    });
  }
}

export async function updateLocationImage({
  organizationId,
  request,
  locationId,
  prevImageUrl,
  prevThumbnailUrl,
}: {
  organizationId: Organization["id"];
  request: Request;
  locationId: Location["id"];
  prevImageUrl?: string | null;
  prevThumbnailUrl?: string | null;
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: PUBLIC_BUCKET,
      newFileName: getFileUploadPath({
        organizationId,
        type: "locations",
        typeId: locationId,
      }),
      resizeOptions: {
        width: 1200,
        withoutEnlargement: true,
      },
      generateThumbnail: true,
      thumbnailSize: 108,
    });

    const image = fileData.get("image") as string | null;
    if (!image) {
      return;
    }

    let imagePath: string;
    let thumbnailPath: string | null = null;

    try {
      const parsedImage = JSON.parse(image);
      if (parsedImage.originalPath) {
        imagePath = parsedImage.originalPath;
        thumbnailPath = parsedImage.thumbnailPath;
      } else {
        imagePath = image;
      }
    } catch (error) {
      imagePath = image;
    }

    const {
      data: { publicUrl: imagePublicUrl },
    } = getSupabaseAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(imagePath);

    let thumbnailPublicUrl: string | undefined;
    if (thumbnailPath) {
      const {
        data: { publicUrl },
      } = getSupabaseAdmin()
        .storage.from(PUBLIC_BUCKET)
        .getPublicUrl(thumbnailPath);
      thumbnailPublicUrl = publicUrl;
    }

    await db.location.update({
      where: { id: locationId, organizationId },
      data: {
        imageUrl: imagePublicUrl,
        thumbnailUrl: thumbnailPublicUrl ? thumbnailPublicUrl : undefined,
      },
    });

    if (prevImageUrl) {
      await removePublicFile({ publicUrl: prevImageUrl });
    }

    if (prevThumbnailUrl) {
      await removePublicFile({ publicUrl: prevThumbnailUrl });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating the location image.",
      additionalData: { locationId },
      label,
    });
  }
}

export async function generateLocationWithImages({
  organizationId,
  numberOfLocations,
  image,
  userId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  numberOfLocations: number;
  image: File;
}) {
  try {
    for (let i = 1; i <= numberOfLocations; i++) {
      const imageCreated = await db.image.create({
        data: {
          blob: Buffer.from(await image.arrayBuffer()),
          contentType: image.type,
          ownerOrg: { connect: { id: organizationId } },
          user: { connect: { id: userId } },
        },
      });

      await db.location.create({
        data: {
          /**
           * We are using id() for names because location names are unique.
           * This location is going to be created for testing purposes only so the name in this case
           * doesn't matter.
           */
          name: id(),
          /**
           * This approach is @deprecated and will not be used in the future.
           * Instead, we will store images in supabase storage and use the public URL.
           */
          image: { connect: { id: imageCreated.id } },
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
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while generating locations.",
      additionalData: { organizationId, numberOfLocations },
      label,
    });
  }
}

export async function getLocationKits(
  params: Pick<Location, "id"> & {
    organizationId: Organization["id"];
    /** Page number. Starts at 1 */
    page?: number;
    /** Assets to be loaded per page with the location */
    perPage?: number;
    search?: string | null;
    orderBy?: string;
    orderDirection?: "asc" | "desc";
  }
) {
  const {
    organizationId,
    id,
    page = 1,
    perPage = 8,
    search,
    orderBy = "createdAt",
    orderDirection,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    const kitWhere: Prisma.KitWhereInput = {
      organizationId,
      locationId: id,
    };

    if (search) {
      kitWhere.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [kits, totalKits] = await Promise.all([
      db.kit.findMany({
        where: kitWhere,
        include: { category: true },
        skip,
        take,
        orderBy: { [orderBy]: orderDirection },
      }),
      db.kit.count({ where: kitWhere }),
    ]);

    return { kits, totalKits };
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Something went wrong while fetching the location kits",
      message:
        "Something went wrong while fetching the location kits. Please try again or contact support.",
      label,
    });
  }
}

export async function createLocationChangeNote({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetName,
  assetId,
  userId,
  isRemoving,
}: {
  currentLocation: Pick<Location, "id" | "name"> | null;
  newLocation: Location | null;
  firstName: string;
  lastName: string;
  assetName: Asset["title"];
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
}) {
  try {
    const message = getLocationUpdateNoteContent({
      currentLocation,
      newLocation,
      firstName,
      lastName,
      assetName,
      isRemoving,
    });

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a location change note. Please try again or contact support",
      additionalData: { userId, assetId },
      label,
    });
  }
}

async function createBulkLocationChangeNotes({
  modifiedAssets,
  assetIds,
  removedAssetIds,
  userId,
  location,
}: {
  modifiedAssets: Prisma.AssetGetPayload<{
    select: {
      title: true;
      id: true;
      location: {
        select: {
          name: true;
          id: true;
        };
      };
      user: {
        select: {
          firstName: true;
          lastName: true;
          id: true;
        };
      };
    };
  }>[];
  assetIds: Asset["id"][];
  removedAssetIds: Asset["id"][];
  userId: User["id"];
  location: Location;
}) {
  try {
    const user = await db.user
      .findFirstOrThrow({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "User not found",
          additionalData: { userId },
          label,
        });
      });

    // Iterate over the modified assets
    for (const asset of modifiedAssets) {
      const isRemoving = removedAssetIds.includes(asset.id);
      const isNew = assetIds.includes(asset.id);
      const newLocation = isRemoving ? null : location;
      const currentLocation = asset.location
        ? { name: asset.location.name, id: asset.location.id }
        : null;

      if (isNew || isRemoving) {
        await createLocationChangeNote({
          currentLocation,
          newLocation,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          assetName: asset.title,
          assetId: asset.id,
          userId,
          isRemoving,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating bulk location change notes",
      additionalData: { userId, assetIds, removedAssetIds },
      label,
    });
  }
}

export async function updateLocationAssets({
  assetIds,
  organizationId,
  locationId,
  userId,
  request,
  removedAssetIds,
}: {
  assetIds: Asset["id"][];
  organizationId: Location["organizationId"];
  locationId: Location["id"];
  userId: User["id"];
  request: Request;
  removedAssetIds: Asset["id"][];
}) {
  try {
    const location = await db.location
      .findUniqueOrThrow({
        where: {
          id: locationId,
          organizationId,
        },
        include: {
          assets: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Location not found",
          additionalData: { locationId, userId, organizationId },
          status: 404,
          label: "Location",
        });
      });

    /**
     * If user has selected all assets, then we have to get ids of all those assets
     * with respect to the filters applied.
     * */
    const hasSelectedAll = assetIds.includes(ALL_SELECTED_KEY);
    if (hasSelectedAll) {
      const searchParams = getCurrentSearchParams(request);
      const assetsWhere = getAssetsWhereInput({
        organizationId,
        currentSearchParams: searchParams.toString(),
      });

      const allAssets = await db.asset.findMany({
        where: assetsWhere,
        select: { id: true },
      });

      const locationAssets = location.assets.map((asset) => asset.id);
      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...locationAssets.filter((asset) => !removedAssetIds.includes(asset)),
        ]),
      ];
    }

    /**
     * We need to query all the modified assets so we know their location before the change
     * That way we can later create notes for all the location changes
     */
    const modifiedAssets = await db.asset
      .findMany({
        where: {
          id: {
            in: [...assetIds, ...removedAssetIds],
          },
          organizationId,
        },
        select: {
          title: true,
          id: true,
          location: {
            select: {
              name: true,
              id: true,
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              id: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, removedAssetIds, userId, locationId },
          label: "Assets",
        });
      });

    if (assetIds.length > 0) {
      /** We update the location with the new assets */
      await db.location
        .update({
          where: {
            id: locationId,
            organizationId,
          },
          data: {
            assets: {
              connect: assetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while adding the assets to the location. Please try again or contact support.",
            additionalData: { assetIds, userId, locationId },
            label: "Location",
          });
        });
    }

    /** If some assets were removed, we also need to handle those */
    if (removedAssetIds.length > 0) {
      await db.location
        .update({
          where: {
            organizationId,
            id: locationId,
          },
          data: {
            assets: {
              disconnect: removedAssetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while removing the assets from the location. Please try again or contact support.",
            additionalData: { removedAssetIds, userId, locationId },
            label: "Location",
          });
        });
    }

    /** Creates the relevant notes for all the changed assets */
    await createBulkLocationChangeNotes({
      modifiedAssets,
      assetIds,
      removedAssetIds,
      userId,
      location,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the location assets.",
      additionalData: { assetIds, organizationId, locationId },
      label,
    });
  }
}

export async function updateLocationKits({
  locationId,
  kitIds,
  removedKitIds,
  organizationId,
  userId,
  request,
}: {
  locationId: Location["id"];
  kitIds: Kit["id"][];
  removedKitIds: Kit["id"][];
  organizationId: Location["organizationId"];
  userId: User["id"];
  request: Request;
}) {
  try {
    const location = await db.location
      .findUniqueOrThrow({
        where: { id: locationId, organizationId },
        include: {
          kits: {
            select: {
              id: true,
              assets: { select: { id: true } },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Location not found",
          additionalData: { locationId, userId, organizationId },
          status: 404,
          label: "Location",
        });
      });

    /**
     * If user has selected all kits, then we have to get ids of all those kits
     * with respect to the filters applied.
     * */
    const hasSelectedAll = kitIds.includes(ALL_SELECTED_KEY);
    if (hasSelectedAll) {
      const searchParams = getCurrentSearchParams(request);
      const kitWhere = getKitsWhereInput({
        organizationId,
        currentSearchParams: searchParams.toString(),
      });

      const allKits = await db.kit.findMany({
        where: kitWhere,
        select: {
          id: true,
          assets: { select: { id: true } },
        },
      });

      const locationKits = location.kits.map((kit) => kit.id);
      /**
       * New kits that needs to be added are
       * - Previously added kits
       * - All kits with applied filters
       */
      kitIds = [
        ...new Set([
          ...allKits.map((kit) => kit.id),
          ...locationKits.filter((kit) => !removedKitIds.includes(kit)),
        ]),
      ];
    }

    if (kitIds.length > 0) {
      // Get all asset IDs from the kits that are being added to this location
      const kitsToAdd = await db.kit.findMany({
        where: { id: { in: kitIds }, organizationId },
        select: {
          id: true,
          assets: {
            select: {
              id: true,
              title: true,
              location: { select: { id: true, name: true } },
            },
          },
        },
      });

      const assetIds = kitsToAdd.flatMap((kit) =>
        kit.assets.map((asset) => asset.id)
      );

      /** We update the location with the new kits and their assets */
      await db.location
        .update({
          where: {
            id: locationId,
            organizationId,
          },
          data: {
            kits: {
              connect: kitIds.map((id) => ({
                id,
              })),
            },
            assets: {
              connect: assetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while adding the kits to the location. Please try again or contact support.",
            additionalData: { kitIds, userId, locationId },
            label: "Location",
          });
        });

      // Add notes to the assets that their location was updated via their parent kit
      if (assetIds.length > 0) {
        const user = await getUserByID(userId);
        const allAssets = kitsToAdd.flatMap((kit) => kit.assets);

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location, // Use the asset's current location
                newLocation: location,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                assetName: asset.title,
                isRemoving: false,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    }

    /** If some kits were removed, we also need to handle those */
    if (removedKitIds.length > 0) {
      // Get asset IDs from the kits being removed
      const kitsBeingRemoved = await db.kit.findMany({
        where: { id: { in: removedKitIds }, organizationId },
        select: { id: true, assets: { select: { id: true, title: true } } },
      });

      const removedAssetIds = kitsBeingRemoved.flatMap((kit) =>
        kit.assets.map((asset) => asset.id)
      );

      await db.location
        .update({
          where: {
            organizationId,
            id: locationId,
          },
          data: {
            kits: {
              disconnect: removedKitIds.map((id) => ({
                id,
              })),
            },
            assets: {
              disconnect: removedAssetIds.map((id) => ({
                id,
              })),
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while removing the kits from the location. Please try again or contact support.",
            additionalData: { removedKitIds, userId, locationId },
            label: "Location",
          });
        });

      // Add notes to the assets that their location was removed via their parent kit
      if (removedAssetIds.length > 0) {
        const user = await getUserByID(userId);
        const allRemovedAssets = kitsBeingRemoved.flatMap((kit) => kit.assets);

        // Create individual notes for each asset
        await Promise.all(
          allRemovedAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: location,
                newLocation: null,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                assetName: asset.title,
                isRemoving: true,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the location kits.",
      additionalData: { locationId, kitIds },
      label,
    });
  }
}
