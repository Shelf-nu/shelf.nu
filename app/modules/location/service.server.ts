import type {
  Prisma,
  User,
  Location,
  Organization,
  UserOrganization,
  Asset,
  Kit,
} from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
  PUBLIC_BUCKET,
} from "~/utils/constants";
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
  wrapAssetsWithDataForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
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
import {
  createLocationNote as createLocationActivityNote,
  createSystemLocationNote as createSystemLocationActivityNote,
} from "../location-note/service.server";
import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Location";
const MAX_LOCATION_DEPTH = 12;

/** Helper to safely display a value, showing a dash if empty */
function safeDisplay(value?: string | null) {
  return value?.trim() || "—";
}

/** Formats a location as a markdoc link for activity notes */
function formatLocationLink(location: Pick<Location, "id" | "name">) {
  const name = safeDisplay(location.name);
  return wrapLinkForNote(`/locations/${location.id}`, name);
}

/** Builds a formatted list of assets for activity notes */
function buildAssetListMarkup(
  assets: Array<{ id: string; title: string }>,
  action: "added" | "removed"
) {
  const sanitized = assets.map((a) => ({
    id: a.id,
    title: safeDisplay(a.title),
  }));
  return wrapAssetsWithDataForNote(sanitized, action);
}

/** Builds a formatted list of kits for activity notes */
function buildKitListMarkup(
  kits: Array<{ id: string; name: string }>,
  action: "added" | "removed"
) {
  return kits
    .map((kit) =>
      wrapKitsWithDataForNote(
        { id: kit.id, name: safeDisplay(kit.name) },
        action
      )
    )
    .join(", ");
}

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
    teamMemberIds?: string[] | null;
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
    teamMemberIds,
  } = params;

  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Build where object for querying related assets */
    const assetsWhere: Prisma.AssetWhereInput = {};

    if (search) {
      assetsWhere.title = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (teamMemberIds && teamMemberIds.length) {
      assetsWhere.OR = [
        ...(assetsWhere.OR ?? []),
        {
          custody: { teamMemberId: { in: teamMemberIds } },
        },
        {
          custody: { custodian: { userId: { in: teamMemberIds } } },
        },
        {
          bookings: {
            some: {
              custodianTeamMemberId: { in: teamMemberIds },
              status: {
                in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
              },
            },
          },
        },
        {
          bookings: {
            some: {
              custodianUserId: { in: teamMemberIds },
              status: {
                in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: null }]
          : []),
      ];
    }

    const parentInclude = {
      select: {
        id: true,
        name: true,
        parentId: true,
        _count: { select: { children: true } },
      },
    } satisfies Prisma.LocationInclude["parent"];

    const locationInclude: Prisma.LocationInclude = include
      ? { ...include, parent: parentInclude }
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
              custody: {
                select: {
                  custodian: {
                    select: {
                      id: true,
                      name: true,
                      user: {
                        select: {
                          id: true,
                          firstName: true,
                          lastName: true,
                          profilePicture: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            skip,
            take,
            where: assetsWhere,
            orderBy: { [orderBy]: orderDirection },
          },
          parent: parentInclude,
        };

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
        include: locationInclude,
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

export type LocationHierarchyEntry = Pick<
  Location,
  "id" | "name" | "parentId"
> & {
  depth: number;
};

/**
 * Returns the ancestor chain for a given location ordered from the root down to the provided node.
 */
export async function getLocationHierarchy(params: {
  organizationId: Organization["id"];
  locationId: Location["id"];
}) {
  const { organizationId, locationId } = params;

  return db.$queryRaw<LocationHierarchyEntry[]>`
    WITH RECURSIVE location_hierarchy AS (
      SELECT
        id,
        name,
        "parentId",
        "organizationId",
        0 AS depth
      FROM "Location"
      WHERE id = ${locationId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT
        l.id,
        l.name,
        l."parentId",
        l."organizationId",
        lh.depth + 1 AS depth
      FROM "Location" l
      INNER JOIN location_hierarchy lh ON lh."parentId" = l.id
      WHERE l."organizationId" = ${organizationId}
    )
    SELECT id, name, "parentId", depth
    FROM location_hierarchy
    ORDER BY depth DESC
  `;
}

/** Represents a node in the descendant tree rendered on location detail pages. */
export type LocationTreeNode = Pick<Location, "id" | "name"> & {
  children: LocationTreeNode[];
};

/** Raw row returned when querying descendants via recursive CTE. */
type LocationDescendantRow = Pick<Location, "id" | "name" | "parentId">;
/** Aggregate row holding the maximum depth returned from subtree depth query. */
type SubtreeDepthRow = { maxDepth: number | null };

/**
 * Fetches a nested tree of all descendants for the provided location.
 * Used to render the hierarchical child list on the location page sidebar.
 */
export async function getLocationDescendantsTree(params: {
  organizationId: Organization["id"];
  locationId: Location["id"];
}): Promise<LocationTreeNode[]> {
  const { organizationId, locationId } = params;

  const descendants = await db.$queryRaw<LocationDescendantRow[]>`
    WITH RECURSIVE location_descendants AS (
      SELECT
        id,
        name,
        "parentId",
        "organizationId"
      FROM "Location"
      WHERE "parentId" = ${locationId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT
        l.id,
        l.name,
        l."parentId",
        l."organizationId"
      FROM "Location" l
      INNER JOIN location_descendants ld ON ld.id = l."parentId"
      WHERE l."organizationId" = ${organizationId}
    )
    SELECT id, name, "parentId"
    FROM location_descendants
  `;

  const nodes = new Map<string, LocationTreeNode>();
  const rootNodes: LocationTreeNode[] = [];

  for (const row of descendants) {
    nodes.set(row.id, { id: row.id, name: row.name, children: [] });
  }

  for (const row of descendants) {
    const node = nodes.get(row.id);
    if (!node) continue;

    if (row.parentId === locationId) {
      rootNodes.push(node);
    }

    const parentNode = row.parentId ? nodes.get(row.parentId) : null;
    if (parentNode) {
      parentNode.children.push(node);
    }
  }

  return rootNodes;
}

/**
 * Returns the maximum depth (root node counted as 0) for a location's subtree.
 * Used by validation to ensure re-parent operations do not exceed the configured max depth.
 */
export async function getLocationSubtreeDepth(params: {
  organizationId: Organization["id"];
  locationId: Location["id"];
}): Promise<number> {
  const { organizationId, locationId } = params;

  const [result] = await db.$queryRaw<SubtreeDepthRow[]>`
    WITH RECURSIVE location_subtree AS (
      SELECT
        id,
        "parentId",
        "organizationId",
        0 AS depth
      FROM "Location"
      WHERE id = ${locationId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT
        l.id,
        l."parentId",
        l."organizationId",
        ls.depth + 1 AS depth
      FROM "Location" l
      INNER JOIN location_subtree ls ON l."parentId" = ls.id
      WHERE l."organizationId" = ${organizationId}
    )
    SELECT MAX(depth) AS "maxDepth"
    FROM location_subtree
  `;

  return result?.maxDepth ?? 0;
}

export const LOCATION_LIST_INCLUDE = {
  _count: { select: { kits: true, assets: true, children: true } },
  parent: {
    select: {
      id: true,
      name: true,
      parentId: true,
      _count: { select: { children: true } },
    },
  },
  image: { select: { updatedAt: true } },
} satisfies Prisma.LocationInclude;

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
    const where: Prisma.LocationWhereInput = { organizationId };

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
        include: LOCATION_LIST_INCLUDE,
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

export async function getLocationTotalValuation({
  locationId,
}: {
  locationId: Location["id"];
}) {
  const result = await db.asset.aggregate({
    _sum: { valuation: true },
    where: { locationId },
  });

  return result._sum.valuation ?? 0;
}

/**
 * Validates that a parent location belongs to the same organization, does not create cycles,
 * and keeps the tree depth under {@link MAX_LOCATION_DEPTH}.
 */
async function validateParentLocation({
  organizationId,
  parentId,
  currentLocationId,
}: {
  organizationId: Organization["id"];
  parentId?: Location["parentId"];
  currentLocationId?: Location["id"];
}) {
  if (!parentId) {
    return null;
  }

  if (currentLocationId && parentId === currentLocationId) {
    throw new ShelfError({
      cause: null,
      message: "A location cannot be its own parent.",
      additionalData: { currentLocationId, parentId, organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const parentLocation = await db.location.findFirst({
    where: { id: parentId, organizationId },
    select: { id: true },
  });

  if (!parentLocation) {
    throw new ShelfError({
      cause: null,
      message: "Parent location not found.",
      additionalData: { parentId, organizationId },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const hierarchy = await getLocationHierarchy({
    organizationId,
    locationId: parentId,
  });

  const parentDepth = hierarchy.reduce(
    (maxDepth, location) => Math.max(maxDepth, location.depth),
    0
  );

  const subtreeDepth =
    currentLocationId === undefined
      ? 0
      : await getLocationSubtreeDepth({
          organizationId,
          locationId: currentLocationId,
        });

  if (parentDepth + 1 + subtreeDepth > MAX_LOCATION_DEPTH) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: `Locations cannot be nested deeper than ${MAX_LOCATION_DEPTH} levels.`,
      additionalData: {
        parentId,
        organizationId,
        parentDepth,
        subtreeDepth,
      },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  if (currentLocationId && hierarchy.some((l) => l.id === currentLocationId)) {
    throw new ShelfError({
      cause: null,
      message: "A location cannot be assigned to one of its descendants.",
      additionalData: { parentId, currentLocationId, organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return parentLocation.id;
}

export async function createLocation({
  name,
  description,
  address,
  userId,
  organizationId,
  parentId,
}: Pick<Location, "description" | "name" | "address"> & {
  userId: User["id"];
  organizationId: Organization["id"];
  parentId?: Location["parentId"];
}) {
  try {
    // Geocode the address if provided
    let coordinates: { lat: number; lon: number } | null = null;
    if (address) {
      coordinates = await geolocate(address);
    }

    const validatedParentId = await validateParentLocation({
      organizationId,
      parentId,
    });

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
        ...(validatedParentId && {
          parent: {
            connect: {
              id: validatedParentId,
            },
          },
        }),
      },
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }
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
  parentId?: Location["parentId"];
}) {
  const { id, name, address, description, userId, organizationId, parentId } =
    payload;

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

    const validatedParentId =
      parentId === undefined
        ? undefined
        : await validateParentLocation({
            organizationId,
            parentId,
            currentLocationId: id,
          });

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
        ...(validatedParentId !== undefined && {
          parent: validatedParentId
            ? {
                connect: {
                  id: validatedParentId,
                },
              }
            : { disconnect: true },
        }),
      },
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }
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
      maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
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
    } catch (_error) {
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
      additionalData: { locationId, field: "image" },
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
    teamMemberIds?: string[] | null;
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
    teamMemberIds,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    const kitWhere: Prisma.KitWhereInput = {
      organizationId,
      locationId: id,
    };

    if (teamMemberIds && teamMemberIds.length) {
      kitWhere.OR = [
        ...(kitWhere.OR ?? []),
        {
          custody: { custodianId: { in: teamMemberIds } },
        },
        {
          custody: { custodian: { userId: { in: teamMemberIds } } },
        },
        {
          assets: {
            some: {
              bookings: {
                some: {
                  custodianTeamMemberId: { in: teamMemberIds },
                  status: {
                    in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                  },
                },
              },
            },
          },
        },
        {
          assets: {
            some: {
              bookings: {
                some: {
                  custodianUserId: { in: teamMemberIds },
                  status: {
                    in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                  },
                },
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: null }]
          : []),
      ];
    }

    if (search) {
      kitWhere.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [kits, totalKits] = await Promise.all([
      db.kit.findMany({
        where: kitWhere,
        include: {
          category: true,
          custody: {
            select: {
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
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
  assetId,
  userId,
  isRemoving,
}: {
  currentLocation: Pick<Location, "id" | "name"> | null;
  newLocation: Location | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
}) {
  try {
    const message = getLocationUpdateNoteContent({
      currentLocation,
      newLocation,
      userId,
      firstName,
      lastName,
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
  location: Pick<Location, "id" | "name">;
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

    const addedAssets: Array<{ id: string; title: string }> = [];
    const removedAssetsSummary: Array<{ id: string; title: string }> = [];

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
          assetId: asset.id,
          userId,
          isRemoving,
        });

        if (isNew && newLocation) {
          addedAssets.push({ id: asset.id, title: asset.title });
        }

        if (isRemoving && currentLocation) {
          removedAssetsSummary.push({ id: asset.id, title: asset.title });
        }
      }
    }

    // Create summary notes on the location's activity log
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    if (addedAssets.length > 0) {
      const content = `${userLink} added ${buildAssetListMarkup(
        addedAssets,
        "added"
      )} to ${formatLocationLink(location)}.`;
      await createSystemLocationActivityNote({
        locationId: location.id,
        content,
      });
    }

    if (removedAssetsSummary.length > 0) {
      const content = `${userLink} removed ${buildAssetListMarkup(
        removedAssetsSummary,
        "removed"
      )} from ${formatLocationLink(location)}.`;
      await createSystemLocationActivityNote({
        locationId: location.id,
        content,
      });
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
     * Filter out assets already at this location - they don't need notes
     * since no actual change is happening for them.
     */
    const existingAssetIds = new Set(location.assets.map((a) => a.id));
    const actuallyNewAssetIds = assetIds.filter(
      (id) => !existingAssetIds.has(id)
    );

    /**
     * We need to query all the modified assets so we know their location before the change
     * That way we can later create notes for all the location changes
     */
    const modifiedAssets = await db.asset
      .findMany({
        where: {
          id: {
            in: [...actuallyNewAssetIds, ...removedAssetIds],
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
      assetIds: actuallyNewAssetIds,
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

    /**
     * Filter out kits already at this location - they don't need notes
     * since no actual change is happening for them.
     */
    const existingKitIds = new Set(location.kits.map((k) => k.id));
    const actuallyNewKitIds = kitIds.filter((id) => !existingKitIds.has(id));

    /**
     * Also compute asset IDs that are already at this location via existing kits
     * so we don't create duplicate notes for them.
     */
    const existingKitAssetIds = new Set(
      location.kits.flatMap((kit) => kit.assets.map((a) => a.id))
    );

    if (kitIds.length > 0) {
      // Get all asset IDs from the kits that are being added to this location
      const kitsToAdd = await db.kit.findMany({
        where: { id: { in: kitIds }, organizationId },
        select: {
          id: true,
          name: true,
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

      const user = await getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      });

      // Only include actually new kits in the summary note
      const kitsSummary = kitsToAdd
        .filter((kit) => actuallyNewKitIds.includes(kit.id))
        .map((kit) => ({
          id: kit.id,
          name: kit.name ?? kit.id,
        }));

      if (kitsSummary.length > 0) {
        const userLink = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });

        await createSystemLocationActivityNote({
          locationId,
          content: `${userLink} added ${buildKitListMarkup(
            kitsSummary,
            "added"
          )} to ${formatLocationLink(location)}.`,
        });
      }

      // Add notes to the assets that their location was updated via their parent kit
      // Only include assets not already at this location
      if (assetIds.length > 0) {
        const allAssets = kitsToAdd
          .flatMap((kit) => kit.assets)
          .filter((asset) => !existingKitAssetIds.has(asset.id));

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location, // Use the asset's current location
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
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
        select: {
          id: true,
          name: true,
          assets: { select: { id: true, title: true } },
        },
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
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Prisma.UserSelect,
        });
        const allRemovedAssets = kitsBeingRemoved.flatMap((kit) => kit.assets);

        // Create location activity note for removed kits
        const removedKitsSummary = kitsBeingRemoved.map((kit) => ({
          id: kit.id,
          name: kit.name ?? kit.id,
        }));

        if (removedKitsSummary.length > 0) {
          const userLink = wrapUserLinkForNote({
            id: userId,
            firstName: user?.firstName,
            lastName: user?.lastName,
          });

          await createSystemLocationActivityNote({
            locationId,
            content: `${userLink} removed ${buildKitListMarkup(
              removedKitsSummary,
              "removed"
            )} from ${formatLocationLink(location)}.`,
          });
        }

        // Create individual notes for each asset
        await Promise.all(
          allRemovedAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: location,
                newLocation: null,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
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
