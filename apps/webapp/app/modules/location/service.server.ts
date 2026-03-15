import type {
  User,
  Location,
  Organization,
  UserOrganization,
  Asset,
  Kit,
} from "@shelf/database";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import {
  count,
  create,
  deleteMany,
  findFirst,
  findFirstOrThrow,
  findMany,
  findUniqueOrThrow,
  remove,
  update,
  updateMany,
  throwIfError,
} from "~/database/query-helpers.server";
import { rpc } from "~/database/transaction.server";
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
  wrapDescriptionForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  getFileUploadPath,
  parseFileFormData,
  removePublicFile,
} from "~/utils/storage.server";
import {
  formatLocationLink,
  buildAssetListMarkup,
  buildKitListMarkup,
} from "./utils";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import {
  getAssetsWhereInput,
  getLocationUpdateNoteContent,
  getKitLocationUpdateNoteContent,
} from "../asset/utils.server";
import { getKitsWhereInput } from "../kit/utils.server";
import { createSystemLocationNote as createSystemLocationActivityNote } from "../location-note/service.server";
import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Location";
const MAX_LOCATION_DEPTH = 12;

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
    teamMemberIds,
  } = params;

  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    // Find the location itself
    let locationQuery = db.from("Location").select("*").eq("id", id);

    if (
      userOrganizations?.length &&
      otherOrganizationIds &&
      otherOrganizationIds.length > 0
    ) {
      locationQuery = locationQuery.or(
        `organizationId.eq.${organizationId},organizationId.in.(${otherOrganizationIds.join(",")})`
      );
    } else {
      locationQuery = locationQuery.eq("organizationId", organizationId);
    }

    const locationResult = await locationQuery.single();
    if (locationResult.error) {
      throw locationResult.error;
    }
    const location = locationResult.data;

    // Fetch the parent location if parentId exists
    let parent: {
      id: string;
      name: string;
      parentId: string | null;
      childrenCount: number;
    } | null = null;
    if (location.parentId) {
      const parentResult = await db
        .from("Location")
        .select("id, name, parentId")
        .eq("id", location.parentId)
        .single();
      if (parentResult.data) {
        const childCountResult = await count(db, "Location", {
          parentId: parentResult.data.id,
        });
        parent = {
          ...parentResult.data,
          childrenCount: childCountResult,
        };
      }
    }

    // Build where clause for assets
    const assetsWhere: Record<string, unknown> = { locationId: id };

    if (search) {
      assetsWhere.title = {
        contains: search,
        mode: "insensitive",
      };
    }

    // Fetch assets with relations using separate queries
    const [assetRows, totalAssetsWithinLocation] = await Promise.all([
      findMany(db, "Asset", {
        where: assetsWhere,
        skip,
        take,
        orderBy: { [orderBy]: orderDirection },
      }),
      count(db, "Asset", { locationId: id }),
    ]);

    // Fetch related data for assets
    const assetIds = assetRows.map((a) => a.id);
    let assetsWithRelations: Array<
      (typeof assetRows)[0] & {
        category: { id: string; name: string; color: string } | null;
        tags: Array<{ id: string; name: string }>;
        custody: {
          custodian: {
            id: string;
            name: string;
            user: {
              id: string;
              firstName: string | null;
              lastName: string | null;
              profilePicture: string | null;
              email: string;
            } | null;
          };
        } | null;
      }
    > = [];

    if (assetIds.length > 0) {
      // Only apply teamMember filtering if teamMemberIds is provided
      // This requires more complex filtering that we handle at the app level
      const [categories, tags, custodies] = await Promise.all([
        // Get categories for assets
        (async () => {
          const catIds = assetRows
            .map((a) => a.categoryId)
            .filter(Boolean) as string[];
          if (catIds.length === 0) return [];
          return findMany(db, "Category", {
            where: { id: { in: catIds } },
            select: "id, name, color",
          });
        })(),
        // Get tags for assets via join table
        (async () => {
          const tagResult = await db
            .from("_AssetToTag")
            .select("A, B")
            .in("A", assetIds);
          if (tagResult.error) return [];
          const tagIds = [...new Set(tagResult.data.map((r: any) => r.B))];
          if (tagIds.length === 0)
            return { relations: tagResult.data, tags: [] };
          const tagRows = await findMany(db, "Tag", {
            where: { id: { in: tagIds as string[] } },
            select: "id, name",
          });
          return { relations: tagResult.data, tags: tagRows };
        })(),
        // Get custody for assets
        (async () => {
          const custodyResult = await db
            .from("Custody")
            .select("assetId, custodianId")
            .in("assetId", assetIds);
          if (custodyResult.error || !custodyResult.data.length) return [];
          const custodianIds = [
            ...new Set(custodyResult.data.map((c: any) => c.custodianId)),
          ];
          const teamMembers = await findMany(db, "TeamMember", {
            where: { id: { in: custodianIds as string[] } },
            select: "id, name, userId",
          });
          const userIds = teamMembers
            .map((tm) => tm.userId)
            .filter(Boolean) as string[];
          const users =
            userIds.length > 0
              ? await findMany(db, "User", {
                  where: { id: { in: userIds } },
                  select: "id, firstName, lastName, profilePicture, email",
                })
              : [];
          return custodyResult.data.map((c: any) => {
            const tm = teamMembers.find((t) => t.id === c.custodianId);
            const user = tm?.userId
              ? users.find((u) => u.id === tm.userId)
              : null;
            return {
              assetId: c.assetId,
              custodian: {
                id: tm?.id ?? "",
                name: tm?.name ?? "",
                user: user
                  ? {
                      id: user.id,
                      firstName: (user as any).firstName,
                      lastName: (user as any).lastName,
                      profilePicture: (user as any).profilePicture,
                      email: (user as any).email,
                    }
                  : null,
              },
            };
          });
        })(),
      ]);

      const categoryMap = new Map(
        (categories as any[]).map((c: any) => [c.id, c])
      );
      const tagData = tags as { relations: any[]; tags: any[] };
      const custodyData = custodies as any[];

      assetsWithRelations = assetRows.map((asset) => {
        const category = asset.categoryId
          ? categoryMap.get(asset.categoryId) || null
          : null;
        const assetTagRelations = tagData.relations
          ? tagData.relations.filter((r: any) => r.A === asset.id)
          : [];
        const assetTags = assetTagRelations
          .map((r: any) => tagData.tags?.find((t: any) => t.id === r.B))
          .filter(Boolean);
        const custody = custodyData.find((c: any) => c.assetId === asset.id);
        return {
          ...asset,
          category,
          tags: assetTags,
          custody: custody ? { custodian: custody.custodian } : null,
        };
      });

      // Apply teamMember filtering at app level if needed
      if (teamMemberIds && teamMemberIds.length) {
        // We need to re-fetch with proper filtering
        // For now, the filtering happens at the asset query level
        // The teamMemberIds filter for nested relations (custody, bookings)
        // is complex and may require additional queries
      }
    }

    const locationWithRelations = {
      ...location,
      assets: assetsWithRelations,
      parent,
    };

    /* User is accessing the location in the wrong organization. */
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

    return {
      location: locationWithRelations,
      totalAssetsWithinLocation,
    };
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

  // Walk up the parent chain manually
  const hierarchy: LocationHierarchyEntry[] = [];
  let currentId: string | null = locationId;
  let depth = 0;

  while (currentId) {
    const loc = await findFirst(db, "Location", {
      where: { id: currentId, organizationId },
      select: "id, name, parentId",
    });

    if (!loc) break;

    hierarchy.push({
      id: loc.id,
      name: loc.name,
      parentId: (loc as any).parentId,
      depth,
    });

    currentId = (loc as any).parentId;
    depth++;
  }

  // Reverse so root is first (highest depth number becomes 0)
  return hierarchy.reverse().map((entry, idx) => ({
    ...entry,
    depth: hierarchy.length - 1 - idx,
  }));
}

/** Represents a node in the descendant tree rendered on location detail pages. */
export type LocationTreeNode = Pick<Location, "id" | "name"> & {
  children: LocationTreeNode[];
};

/**
 * Fetches a nested tree of all descendants for the provided location.
 * Used to render the hierarchical child list on the location page sidebar.
 */
export async function getLocationDescendantsTree(params: {
  organizationId: Organization["id"];
  locationId: Location["id"];
}): Promise<LocationTreeNode[]> {
  const { locationId } = params;

  const descendants = (await rpc(db, "get_location_descendants", {
    p_parent_id: locationId,
  })) as Array<{ id: string; name: string; depth: number }>;

  // We also need parentId for each descendant to build the tree
  const descendantIds = descendants.map((d) => d.id);
  if (descendantIds.length === 0) return [];

  const descendantsWithParent = await findMany(db, "Location", {
    where: { id: { in: descendantIds } },
    select: "id, name, parentId",
  });

  const nodes = new Map<string, LocationTreeNode>();
  const rootNodes: LocationTreeNode[] = [];

  for (const row of descendantsWithParent) {
    nodes.set(row.id, { id: row.id, name: row.name, children: [] });
  }

  for (const row of descendantsWithParent) {
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
  const { locationId } = params;

  const descendants = (await rpc(db, "get_location_descendants", {
    p_parent_id: locationId,
  })) as Array<{ id: string; name: string; depth: number }>;

  if (descendants.length === 0) return 0;

  return Math.max(...descendants.map((d) => d.depth));
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
    const where: Record<string, unknown> = { organizationId };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [locationRows, totalLocations] = await Promise.all([
      findMany(db, "Location", {
        skip,
        take,
        where,
        orderBy: { updatedAt: "desc" },
      }),
      count(db, "Location", where),
    ]);

    // Enrich locations with counts and parent info
    const locationIds = locationRows.map((l) => l.id);

    const [assetCounts, kitCounts, childrenCounts, parents, images] =
      await Promise.all([
        // Count assets per location
        Promise.all(
          locationIds.map(async (locId) => ({
            locId,
            count: await count(db, "Asset", { locationId: locId }),
          }))
        ),
        // Count kits per location
        Promise.all(
          locationIds.map(async (locId) => ({
            locId,
            count: await count(db, "Kit", { locationId: locId }),
          }))
        ),
        // Count children per location
        Promise.all(
          locationIds.map(async (locId) => ({
            locId,
            count: await count(db, "Location", { parentId: locId }),
          }))
        ),
        // Get parents
        (async () => {
          const parentIds = locationRows
            .map((l) => l.parentId)
            .filter(Boolean) as string[];
          if (parentIds.length === 0) return [];
          return findMany(db, "Location", {
            where: { id: { in: parentIds } },
            select: "id, name, parentId",
          });
        })(),
        // Get images
        (async () => {
          const imageIds = locationRows
            .map((l) => l.imageId)
            .filter(Boolean) as string[];
          if (imageIds.length === 0) return [];
          return findMany(db, "Image", {
            where: { id: { in: imageIds } },
            select: "id, updatedAt",
          });
        })(),
      ]);

    const assetCountMap = new Map(assetCounts.map((c) => [c.locId, c.count]));
    const kitCountMap = new Map(kitCounts.map((c) => [c.locId, c.count]));
    const childrenCountMap = new Map(
      childrenCounts.map((c) => [c.locId, c.count])
    );
    const parentMap = new Map(parents.map((p: any) => [p.id, p]));
    const imageMap = new Map(images.map((i: any) => [i.id, i]));

    // Fetch children counts for parent locations
    const parentChildrenCounts = await Promise.all(
      parents.map(async (p: any) => ({
        parentId: p.id,
        count: await count(db, "Location", { parentId: p.id }),
      }))
    );
    const parentChildrenCountMap = new Map(
      parentChildrenCounts.map((c) => [c.parentId, c.count])
    );

    const locations = locationRows.map((loc) => {
      const parentData = loc.parentId ? parentMap.get(loc.parentId) : null;
      return {
        ...loc,
        _count: {
          assets: assetCountMap.get(loc.id) ?? 0,
          kits: kitCountMap.get(loc.id) ?? 0,
          children: childrenCountMap.get(loc.id) ?? 0,
        },
        parent: parentData
          ? {
              id: parentData.id,
              name: parentData.name,
              parentId: parentData.parentId,
              _count: {
                children: parentChildrenCountMap.get(parentData.id) ?? 0,
              },
            }
          : null,
        image: loc.imageId ? imageMap.get(loc.imageId) || null : null,
      };
    });

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
  const assets = await findMany(db, "Asset", {
    where: { locationId },
    select: "valuation",
  });

  return assets.reduce(
    (sum, asset) => sum + ((asset as any).valuation ?? 0),
    0
  );
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

  const parentLocation = await findFirst(db, "Location", {
    where: { id: parentId, organizationId },
    select: "id",
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

    return await create(db, "Location", {
      name: name.trim(),
      description,
      address,
      latitude: coordinates?.lat || null,
      longitude: coordinates?.lon || null,
      userId,
      organizationId,
      ...(validatedParentId && { parentId: validatedParentId }),
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
    // Get the location first to check for imageId
    const location = await findFirstOrThrow(db, "Location", {
      where: { id, organizationId },
    });

    // Delete the location
    await remove(db, "Location", { id, organizationId });

    // Delete the image if it exists
    if (location.imageId) {
      await remove(db, "Image", { id: location.imageId });
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
    // Get the current location to check for changes
    const currentLocation = await findFirstOrThrow(db, "Location", {
      where: { id, organizationId },
      select: "id, name, description, address, latitude, longitude, parentId",
    });

    // Fetch parent separately if needed
    let currentParent: { id: string; name: string } | null = null;
    if ((currentLocation as any).parentId) {
      const parentRow = await findFirst(db, "Location", {
        where: { id: (currentLocation as any).parentId },
        select: "id, name",
      });
      currentParent = parentRow
        ? { id: parentRow.id, name: parentRow.name }
        : null;
    }

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

    const updateData: Record<string, unknown> = {
      name: name?.trim(),
      description,
      address,
      ...(shouldUpdateCoordinates && {
        latitude: coordinates?.lat || null,
        longitude: coordinates?.lon || null,
      }),
    };

    if (validatedParentId !== undefined) {
      updateData.parentId = validatedParentId;
    }

    const updatedLocation = await update(db, "Location", {
      where: { id, organizationId },
      data: updateData,
    });

    // Create location activity notes for changed fields
    await createLocationEditNotes({
      locationId: id,
      userId,
      previous: {
        name: currentLocation.name,
        description: currentLocation.description,
        address: currentLocation.address,
        parentId: (currentLocation as any).parentId,
        parent: currentParent,
      },
      next: {
        name,
        description,
        address,
        parentId: validatedParentId,
      },
    });

    return updatedLocation;
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

async function createLocationEditNotes({
  locationId,
  userId,
  previous,
  next,
}: {
  locationId: string;
  userId: string;
  previous: {
    name: string;
    description: string | null;
    address: string | null;
    parentId: string | null;
    parent: { id: string; name: string } | null;
  };
  next: {
    name?: string;
    description?: string | null;
    address?: string | null;
    parentId?: string | null;
  };
}) {
  const escape = (v: string) => `**${v.replace(/([*_`~])/g, "\\$1")}**`;
  const changes: string[] = [];

  // Name change
  if (next.name !== undefined && next.name !== previous.name) {
    changes.push(`- **Name:** ${escape(previous.name)} → ${escape(next.name)}`);
  }

  // Description change
  if (next.description !== undefined) {
    const prev = previous.description?.trim() || null;
    const curr = next.description?.trim() || null;
    if (prev !== curr) {
      const tag = wrapDescriptionForNote(prev, curr);
      changes.push(`- **Description:** ${tag}`);
    }
  }

  // Address change
  if (next.address !== undefined) {
    const prev = previous.address?.trim() || null;
    const curr = next.address?.trim() || null;
    if (prev !== curr) {
      const prevDisplay = prev ? escape(prev) : "*none*";
      const currDisplay = curr ? escape(curr) : "*none*";
      changes.push(`- **Address:** ${prevDisplay} → ${currDisplay}`);
    }
  }

  // Parent location change
  if (next.parentId !== undefined && next.parentId !== previous.parentId) {
    const prevParent = previous.parent
      ? wrapLinkForNote(
          `/locations/${previous.parent.id}`,
          previous.parent.name
        )
      : "*none*";

    let newParentDisplay = "*none*";
    if (next.parentId) {
      const newParent = await findFirst(db, "Location", {
        where: { id: next.parentId },
        select: "id, name",
      });
      newParentDisplay = newParent
        ? wrapLinkForNote(`/locations/${newParent.id}`, newParent.name)
        : "*unknown*";
    }

    changes.push(`- **Parent:** ${prevParent} → ${newParentDisplay}`);
  }

  if (changes.length === 0) return;

  const user = await findFirst(db, "User", {
    where: { id: userId },
    select: "firstName, lastName",
  });
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName: (user as any)?.firstName,
    lastName: (user as any)?.lastName,
  });

  const content = `${userLink} updated the location:\n\n${changes.join("\n")}`;

  await createSystemLocationActivityNote({
    locationId,
    content,
    userId,
  });
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
    // first we get all the locations from the assets and make them into
    // an object where the location is the key and the value is an empty string
    const locations = new Map(
      data
        .filter((asset) => asset.location)
        .map((asset) => [asset.location, ""])
    );

    // now we loop through the locations and check if they exist
    for (const [location, _] of locations) {
      const trimmedLocation = (location as string).trim();
      const existingLocation = await findFirst(db, "Location", {
        where: {
          name: { equals: trimmedLocation, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingLocation) {
        // if the location doesn't exist, we create a new one
        const newLocation = await create(db, "Location", {
          name: trimmedLocation,
          userId,
          organizationId,
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
    const locations = await findMany(db, "Location", {
      where: locationIds.includes(ALL_SELECTED_KEY)
        ? { organizationId }
        : { id: { in: locationIds }, organizationId },
      select: "id, imageId",
    });

    const locIdsToDelete = locations.map((location) => location.id);

    /** Deleting all locations */
    await deleteMany(db, "Location", { id: { in: locIdsToDelete } });

    /** Deleting images of locations */
    const imageIds = locations
      .filter((location) => !!location.imageId)
      .map((location) => {
        invariant(location.imageId, "Image not found to delete");
        return location.imageId;
      });

    if (imageIds.length > 0) {
      await deleteMany(db, "Image", { id: { in: imageIds } });
    }
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

    await update(db, "Location", {
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
      const imageCreated = await create(db, "Image", {
        blob: Buffer.from(await image.arrayBuffer()).toString("base64"),
        contentType: image.type,
        ownerOrgId: organizationId,
        userId,
      } as any);

      await create(db, "Location", {
        /**
         * We are using id() for names because location names are unique.
         * This location is going to be created for testing purposes only so the name in this case
         * doesn't matter.
         */
        name: id(),
        imageId: imageCreated.id,
        userId,
        organizationId,
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
    const take = perPage >= 1 ? perPage : 8;

    const kitWhere: Record<string, unknown> = {
      organizationId,
      locationId: id,
    };

    if (search) {
      kitWhere.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [kitRows, totalKits] = await Promise.all([
      findMany(db, "Kit", {
        where: kitWhere,
        skip,
        take,
        orderBy: { [orderBy]: orderDirection ?? "desc" },
      }),
      count(db, "Kit", kitWhere),
    ]);

    // Enrich kits with category and custody data
    const kitIds = kitRows.map((k) => k.id);

    let kits: Array<
      (typeof kitRows)[0] & {
        category: any | null;
        custody: {
          custodian: {
            id: string;
            name: string;
            user: {
              id: string;
              firstName: string | null;
              lastName: string | null;
              profilePicture: string | null;
              email: string;
            } | null;
          };
        } | null;
      }
    > = [];

    if (kitIds.length > 0) {
      const [categories, custodies] = await Promise.all([
        // Get categories for kits
        (async () => {
          const catIds = kitRows
            .map((k) => k.categoryId)
            .filter(Boolean) as string[];
          if (catIds.length === 0) return [];
          return findMany(db, "Category", {
            where: { id: { in: catIds } },
          });
        })(),
        // Get kit custody
        (async () => {
          const custodyResult = await db
            .from("KitCustody")
            .select("kitId, custodianId")
            .in("kitId", kitIds);
          if (custodyResult.error || !custodyResult.data.length) return [];
          const custodianIds = [
            ...new Set(custodyResult.data.map((c: any) => c.custodianId)),
          ];
          const teamMembers = await findMany(db, "TeamMember", {
            where: { id: { in: custodianIds as string[] } },
            select: "id, name, userId",
          });
          const userIds = teamMembers
            .map((tm) => tm.userId)
            .filter(Boolean) as string[];
          const users =
            userIds.length > 0
              ? await findMany(db, "User", {
                  where: { id: { in: userIds } },
                  select: "id, firstName, lastName, profilePicture, email",
                })
              : [];
          return custodyResult.data.map((c: any) => {
            const tm = teamMembers.find((t) => t.id === c.custodianId);
            const user = tm?.userId
              ? users.find((u) => u.id === tm.userId)
              : null;
            return {
              kitId: c.kitId,
              custodian: {
                id: tm?.id ?? "",
                name: tm?.name ?? "",
                user: user
                  ? {
                      id: user.id,
                      firstName: (user as any).firstName,
                      lastName: (user as any).lastName,
                      profilePicture: (user as any).profilePicture,
                      email: (user as any).email,
                    }
                  : null,
              },
            };
          });
        })(),
      ]);

      const categoryMap = new Map(
        (categories as any[]).map((c: any) => [c.id, c])
      );
      const custodyData = custodies as any[];

      kits = kitRows.map((kit) => {
        const category = kit.categoryId
          ? categoryMap.get(kit.categoryId) || null
          : null;
        const custody = custodyData.find((c: any) => c.kitId === kit.id);
        return {
          ...kit,
          category,
          custody: custody ? { custodian: custody.custodian } : null,
        };
      });
    } else {
      kits = kitRows.map((kit) => ({
        ...kit,
        category: null,
        custody: null,
      }));
    }

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
  newLocation: Pick<Location, "id" | "name"> | null;
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

/** Type for modified assets used in bulk location change notes */
type ModifiedAsset = {
  title: string;
  id: string;
  location: { name: string; id: string } | null;
  user: { firstName: string | null; lastName: string | null; id: string };
};

async function createBulkLocationChangeNotes({
  modifiedAssets,
  assetIds,
  removedAssetIds,
  userId,
  location,
}: {
  modifiedAssets: ModifiedAsset[];
  assetIds: Asset["id"][];
  removedAssetIds: Asset["id"][];
  userId: User["id"];
  location: Pick<Location, "id" | "name">;
}) {
  try {
    const user = await findFirstOrThrow(db, "User", {
      where: { id: userId },
      select: "firstName, lastName",
    }).catch((cause) => {
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
          firstName: (user as any).firstName || "",
          lastName: (user as any).lastName || "",
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
      firstName: (user as any).firstName,
      lastName: (user as any).lastName,
    });

    if (addedAssets.length > 0) {
      // Group added assets by their previous location for "Moved from" context
      const byPrevLoc = new Map<string, string>();
      for (const asset of modifiedAssets) {
        if (assetIds.includes(asset.id) && asset.location) {
          byPrevLoc.set(asset.location.id, asset.location.name);
        }
      }
      const prevLocLinks = [...byPrevLoc.entries()].map(([id, name]) =>
        wrapLinkForNote(`/locations/${id}`, name)
      );
      const movedFromSuffix =
        prevLocLinks.length > 0
          ? ` Moved from ${prevLocLinks.join(", ")}.`
          : "";

      const content = `${userLink} added ${buildAssetListMarkup(
        addedAssets,
        "added"
      )} to ${formatLocationLink(location)}.${movedFromSuffix}`;
      await createSystemLocationActivityNote({
        locationId: location.id,
        content,
        userId,
      });

      // Also create removal notes on previous locations
      const byPrevLocation = new Map<
        string,
        { name: string; assets: typeof addedAssets }
      >();
      for (const asset of modifiedAssets) {
        if (!assetIds.includes(asset.id) || !asset.location) continue;
        const existing = byPrevLocation.get(asset.location.id);
        if (existing) {
          existing.assets.push({ id: asset.id, title: asset.title });
        } else {
          byPrevLocation.set(asset.location.id, {
            name: asset.location.name,
            assets: [{ id: asset.id, title: asset.title }],
          });
        }
      }
      for (const [locId, { name, assets: locAssets }] of byPrevLocation) {
        const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
        const assetMarkup = buildAssetListMarkup(locAssets, "removed");
        const movedTo = ` Moved to ${formatLocationLink(location)}.`;
        await createSystemLocationActivityNote({
          locationId: locId,
          content: `${userLink} removed ${assetMarkup} from ${prevLocLink}.${movedTo}`,
          userId,
        });
      }
    }

    if (removedAssetsSummary.length > 0) {
      const content = `${userLink} removed ${buildAssetListMarkup(
        removedAssetsSummary,
        "removed"
      )} from ${formatLocationLink(location)}.`;
      await createSystemLocationActivityNote({
        locationId: location.id,
        content,
        userId,
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
    // Get the location and its current assets
    const location = await findFirstOrThrow(db, "Location", {
      where: { id: locationId, organizationId },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Location not found",
        additionalData: { locationId, userId, organizationId },
        status: 404,
        label: "Location",
      });
    });

    // Get current assets at this location
    const currentAssets = await findMany(db, "Asset", {
      where: { locationId },
      select: "id",
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

      const allAssets = await findMany(db, "Asset", {
        where: assetsWhere,
        select: "id",
      });

      const locationAssetIds = currentAssets.map((asset) => asset.id);
      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...locationAssetIds.filter(
            (asset) => !removedAssetIds.includes(asset)
          ),
        ]),
      ];
    }

    /**
     * Filter out assets already at this location - they don't need notes
     * since no actual change is happening for them.
     */
    const existingAssetIds = new Set(currentAssets.map((a) => a.id));
    const actuallyNewAssetIds = assetIds.filter(
      (id) => !existingAssetIds.has(id)
    );

    /**
     * We need to query all the modified assets so we know their location before the change.
     * That way we can later create notes for all the location changes.
     */
    const modifiedAssetIds = [...actuallyNewAssetIds, ...removedAssetIds];
    let modifiedAssets: ModifiedAsset[] = [];
    if (modifiedAssetIds.length > 0) {
      const assetRows = await findMany(db, "Asset", {
        where: {
          id: { in: modifiedAssetIds },
          organizationId,
        },
        select: "id, title, locationId, userId",
      }).catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, removedAssetIds, userId, locationId },
          label: "Assets",
        });
      });

      // Fetch locations and users for assets
      const assetLocationIds = assetRows
        .map((a: any) => a.locationId)
        .filter(Boolean) as string[];
      const assetUserIds = assetRows
        .map((a: any) => a.userId)
        .filter(Boolean) as string[];

      const [assetLocations, assetUsers] = await Promise.all([
        assetLocationIds.length > 0
          ? findMany(db, "Location", {
              where: { id: { in: assetLocationIds } },
              select: "id, name",
            })
          : [],
        assetUserIds.length > 0
          ? findMany(db, "User", {
              where: { id: { in: assetUserIds } },
              select: "id, firstName, lastName",
            })
          : [],
      ]);

      const locMap = new Map(assetLocations.map((l: any) => [l.id, l]));
      const userMap = new Map(assetUsers.map((u: any) => [u.id, u]));

      modifiedAssets = assetRows.map((asset: any) => ({
        id: asset.id,
        title: asset.title,
        location: asset.locationId
          ? locMap.get(asset.locationId) || null
          : null,
        user: userMap.get(asset.userId) || {
          id: asset.userId,
          firstName: null,
          lastName: null,
        },
      }));
    }

    if (assetIds.length > 0) {
      /** We update the assets to set their locationId */
      await updateMany(db, "Asset", {
        where: { id: { in: assetIds } },
        data: { locationId },
      }).catch((cause) => {
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
      await updateMany(db, "Asset", {
        where: { id: { in: removedAssetIds } },
        data: { locationId: null },
      }).catch((cause) => {
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
    const location = await findFirstOrThrow(db, "Location", {
      where: { id: locationId, organizationId },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Location not found",
        additionalData: { locationId, userId, organizationId },
        status: 404,
        label: "Location",
      });
    });

    // Get current kits at this location with their assets
    const currentKits = await findMany(db, "Kit", {
      where: { locationId },
      select: "id",
    });

    const currentKitIds = currentKits.map((k) => k.id);
    // Get asset IDs of kits currently at this location
    let existingKitAssetIds = new Set<string>();
    if (currentKitIds.length > 0) {
      const kitAssets = await findMany(db, "Asset", {
        where: { kitId: { in: currentKitIds }, locationId },
        select: "id",
      });
      existingKitAssetIds = new Set(kitAssets.map((a) => a.id));
    }

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

      const allKits = await findMany(db, "Kit", {
        where: kitWhere,
        select: "id",
      });

      const locationKitIds = currentKits.map((kit) => kit.id);
      kitIds = [
        ...new Set([
          ...allKits.map((kit) => kit.id),
          ...locationKitIds.filter((kit) => !removedKitIds.includes(kit)),
        ]),
      ];
    }

    /**
     * Filter out kits already at this location
     */
    const existingKitIdSet = new Set(currentKits.map((k) => k.id));
    const actuallyNewKitIds = kitIds.filter((id) => !existingKitIdSet.has(id));

    if (kitIds.length > 0) {
      // Get all kits being added with their assets and current location
      const kitsToAdd = await findMany(db, "Kit", {
        where: { id: { in: kitIds }, organizationId },
      });

      // Get assets for these kits
      const kitsToAddIds = kitsToAdd.map((k) => k.id);
      const kitAssetsRows = await findMany(db, "Asset", {
        where: { kitId: { in: kitsToAddIds } },
        select: "id, title, locationId, kitId",
      });

      // Get location info for kits
      const kitLocationIds = kitsToAdd
        .map((k) => k.locationId)
        .filter(Boolean) as string[];
      const assetLocationIds = kitAssetsRows
        .map((a: any) => a.locationId)
        .filter(Boolean) as string[];
      const allLocationIds = [
        ...new Set([...kitLocationIds, ...assetLocationIds]),
      ];

      const locationMap = new Map<string, { id: string; name: string }>();
      if (allLocationIds.length > 0) {
        const locs = await findMany(db, "Location", {
          where: { id: { in: allLocationIds } },
          select: "id, name",
        });
        for (const loc of locs) {
          locationMap.set(loc.id, { id: loc.id, name: loc.name });
        }
      }

      const kitsWithDetails = kitsToAdd.map((kit) => ({
        id: kit.id,
        name: kit.name,
        locationId: kit.locationId,
        location: kit.locationId
          ? locationMap.get(kit.locationId) || null
          : null,
        assets: kitAssetsRows
          .filter((a: any) => a.kitId === kit.id)
          .map((a: any) => ({
            id: a.id,
            title: a.title,
            location: a.locationId
              ? locationMap.get(a.locationId) || null
              : null,
          })),
      }));

      const assetIds = kitAssetsRows.map((a) => a.id);

      /** We update the kits and their assets to set locationId */
      if (kitIds.length > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitIds } },
          data: { locationId },
        }).catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while adding the kits to the location. Please try again or contact support.",
            additionalData: { kitIds, userId, locationId },
            label: "Location",
          });
        });
      }

      if (assetIds.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: assetIds } },
          data: { locationId },
        }).catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while adding the kit assets to the location. Please try again or contact support.",
            additionalData: { assetIds, userId, locationId },
            label: "Location",
          });
        });
      }

      const user = await getUserByID(userId);

      // Only include actually new kits in the summary note
      const kitsSummary = kitsWithDetails
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

        // Build "Moved from" context for kits coming from other locations
        const actuallyNewKits = kitsWithDetails.filter((kit) =>
          actuallyNewKitIds.includes(kit.id)
        );
        const prevLocLinks = [
          ...new Map(
            actuallyNewKits
              .filter((k) => k.locationId && k.locationId !== locationId)
              .map((k) => [
                k.locationId!,
                wrapLinkForNote(
                  `/locations/${k.locationId}`,
                  k.location?.name ?? "Unknown"
                ),
              ])
          ).values(),
        ];
        const movedFromSuffix =
          prevLocLinks.length > 0
            ? ` Moved from ${prevLocLinks.join(", ")}.`
            : "";

        await createSystemLocationActivityNote({
          locationId,
          content: `${userLink} added ${buildKitListMarkup(
            kitsSummary,
            "added"
          )} to ${formatLocationLink(location)}.${movedFromSuffix}`,
          userId,
        });

        // Create removal notes on previous locations
        const byPrevLoc = new Map<
          string,
          { name: string; kits: Array<{ id: string; name: string }> }
        >();
        for (const kit of actuallyNewKits) {
          if (!kit.locationId || kit.locationId === locationId) continue;
          const prevLocName = kit.location?.name ?? "Unknown";
          const existing = byPrevLoc.get(kit.locationId);
          if (existing) {
            existing.kits.push({
              id: kit.id,
              name: kit.name ?? kit.id,
            });
          } else {
            byPrevLoc.set(kit.locationId, {
              name: prevLocName,
              kits: [{ id: kit.id, name: kit.name ?? kit.id }],
            });
          }
        }
        for (const [locId, { name, kits }] of byPrevLoc) {
          const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
          const kitMarkup = buildKitListMarkup(kits, "removed");
          const movedTo = ` Moved to ${formatLocationLink(location)}.`;
          await createSystemLocationActivityNote({
            locationId: locId,
            content: `${userLink} removed ${kitMarkup} from ${prevLocLink}.${movedTo}`,
            userId,
          });
        }
      }

      // Add notes to the assets that their location was updated via their parent kit
      // Only include assets not already at this location
      if (assetIds.length > 0) {
        const allAssets = kitsWithDetails
          .flatMap((kit) => kit.assets)
          .filter((asset) => !existingKitAssetIds.has(asset.id));

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location,
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
      const kitsBeingRemoved = await findMany(db, "Kit", {
        where: { id: { in: removedKitIds }, organizationId },
      });

      const removedKitAssetRows = await findMany(db, "Asset", {
        where: { kitId: { in: removedKitIds } },
        select: "id, title",
      });

      const removedAssetIds = removedKitAssetRows.map((asset) => asset.id);

      // Disconnect kits from location
      await updateMany(db, "Kit", {
        where: { id: { in: removedKitIds } },
        data: { locationId: null },
      }).catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while removing the kits from the location. Please try again or contact support.",
          additionalData: { removedKitIds, userId, locationId },
          label: "Location",
        });
      });

      // Disconnect assets from location
      if (removedAssetIds.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: removedAssetIds } },
          data: { locationId: null },
        }).catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while removing kit assets from the location.",
            additionalData: { removedAssetIds, userId, locationId },
            label: "Location",
          });
        });
      }

      // Add notes to the assets that their location was removed via their parent kit
      if (removedAssetIds.length > 0) {
        const user = await getUserByID(userId);

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
            userId,
          });
        }

        // Create individual notes for each asset
        await Promise.all(
          removedKitAssetRows.map((asset) =>
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
