import type {
  User,
  Location,
  Organization,
  UserOrganization,
  Asset,
  Kit,
} from "@prisma/client";
import { AssetType, BookingStatus, Prisma } from "@prisma/client";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { assetQtyMeta } from "~/utils/asset-quantity";
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
  LOCATION_SORTING_OPTIONS,
} from "./utils";
import { recordEvent, recordEvents } from "../activity-event/service.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import { getPrimaryLocation } from "../asset/utils";
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

/**
 * SECURITY: Asserts that every supplied asset ID belongs to `organizationId`.
 *
 * Service-layer defense-in-depth guard for the location ↔ asset mutation
 * helpers (`updateLocationAssets`). Without this check, Prisma's 1:N
 * `connect`/`disconnect` on `Location.assets` happily accepts cross-org
 * `assetId`s supplied via the form payload — silently reparenting a victim's
 * asset out of their workspace (CWE-862 / IDOR).
 *
 * @throws {ShelfError} 403 if any of `ids` does not belong to `organizationId`
 */
async function assertAssetsInOrganization({
  ids,
  organizationId,
  additionalData,
}: {
  ids: Asset["id"][];
  organizationId: Organization["id"];
  additionalData?: Record<string, unknown>;
}): Promise<void> {
  if (ids.length === 0) return;

  const authorizedCount = await db.asset.count({
    where: { id: { in: ids }, organizationId },
  });

  if (authorizedCount !== ids.length) {
    throw new ShelfError({
      cause: null,
      title: "Unauthorized",
      message:
        "You are not authorized to modify one or more of the selected assets.",
      additionalData: { ...additionalData, organizationId, ids },
      label,
      status: 403,
      shouldBeCaptured: false,
    });
  }
}

/**
 * SECURITY: Asserts that every supplied kit ID belongs to `organizationId`.
 *
 * Service-layer defense-in-depth guard for the location ↔ kit mutation
 * helpers (`updateLocationKits`). Without this check, Prisma's 1:N
 * `connect`/`disconnect` on `Location.kits` happily accepts cross-org
 * `kitId`s supplied via the form payload — silently reparenting a victim's
 * kit (and its cascading assets) out of their workspace (CWE-862 / IDOR).
 *
 * @throws {ShelfError} 403 if any of `ids` does not belong to `organizationId`
 */
async function assertKitsInOrganization({
  ids,
  organizationId,
  additionalData,
}: {
  ids: Kit["id"][];
  organizationId: Organization["id"];
  additionalData?: Record<string, unknown>;
}): Promise<void> {
  if (ids.length === 0) return;

  const authorizedCount = await db.kit.count({
    where: { id: { in: ids }, organizationId },
  });

  if (authorizedCount !== ids.length) {
    throw new ShelfError({
      cause: null,
      title: "Unauthorized",
      message:
        "You are not authorized to modify one or more of the selected kits.",
      additionalData: { ...additionalData, organizationId, ids },
      label,
      status: 403,
      shouldBeCaptured: false,
    });
  }
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
          custody: { some: { teamMemberId: { in: teamMemberIds } } },
        },
        {
          custody: {
            some: { custodian: { userId: { in: teamMemberIds } } },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianTeamMemberId: { in: teamMemberIds },
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianUserId: { in: teamMemberIds },
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: { none: {} } }]
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

    /**
     * Assets at a location are queried via the `AssetLocation` pivot —
     * there is no `Location.assets` relation. We run a separate
     * `db.asset.findMany` filtered by
     * `assetLocations: { some: { locationId: id } }` and synthesize the
     * `assets` array onto the wrapper return below. Consumers that read
     * `location.assets` from the old shape must read `assets` from the
     * wrapper return value (e.g.
     * `app/routes/_layout+/locations.$locationId.assets.tsx`).
     */
    const locationInclude: Prisma.LocationInclude = include
      ? { ...include, parent: parentInclude }
      : { parent: parentInclude };

    // Scope the assets query to the location via the AssetLocation
    // pivot. Search/teamMember filters are added on top.
    const assetsWhereForLocation: Prisma.AssetWhereInput = {
      assetLocations: { some: { locationId: id } },
      ...assetsWhere,
    };

    const [location, totalAssetsWithinLocation, assets] = await Promise.all([
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
          assetLocations: { some: { locationId: id } },
        },
      }),

      /**
       * Paginated assets placed at this location. Returned alongside
       * the location so consumers can keep using the existing
       * `{ location, assets, totalAssetsWithinLocation }` contract
       * without depending on a `Location.assets` relation (which no
       * longer exists — placement lives on the `AssetLocation` pivot).
       */
      include
        ? Promise.resolve([] as Awaited<ReturnType<typeof db.asset.findMany>>)
        : db.asset.findMany({
            skip,
            take,
            where: assetsWhereForLocation,
            orderBy: { [orderBy]: orderDirection },
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
              /**
               * Pull the pivot rows for THIS location only. An asset
               * can have both a manual row AND one or more kit-driven
               * rows at the same location (`(assetId, locationId)` is
               * not unique), so the renderer aggregates `quantity`
               * across rows and reads `assetKitId` / `assetKit.kit`
               * to surface the "via kit" badge when any row at this
               * location is kit-driven.
               */
              assetLocations: {
                where: { locationId: id },
                select: {
                  locationId: true,
                  quantity: true,
                  assetKitId: true,
                  assetKit: {
                    select: {
                      id: true,
                      kit: { select: { id: true, name: true } },
                    },
                  },
                },
              },
              // Asset-code resolution relations — see
              // `app/modules/barcode/display.ts`. Scalar fields
              // (sequentialId, preferredBarcodeId) are automatically included
              // because this is an `include`, not a `select`.
              qrCodes: { take: 1, select: { id: true } },
              barcodes: { select: { id: true, type: true, value: true } },
              custody: {
                select: {
                  quantity: true,
                  custodian: {
                    select: {
                      id: true,
                      name: true,
                      user: {
                        select: {
                          id: true,
                          firstName: true,
                          lastName: true,
                          displayName: true,
                          profilePicture: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
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

    /**
     * Contract: `assets` is a sibling of `location` on the return
     * value (synthesized from a separate `db.asset.findMany` filtered
     * by the `AssetLocation` pivot). The `location.assets` relation
     * does not exist — placement lives on the pivot. Route consumers
     * (e.g. `app/routes/_layout+/locations.$locationId.assets.tsx`)
     * must read `assets` from this wrapper, not from `location.assets`.
     */
    return { location, totalAssetsWithinLocation, assets };
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
  // Asset count comes from the `AssetLocation` pivot rather than a
  // direct `Location.assets` relation (which doesn't exist).
  _count: { select: { kits: true, assetLocations: true, children: true } },
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
  /** Sort field. Must be a key of LOCATION_SORTING_OPTIONS; falls back to "createdAt". */
  orderBy?: string;
  /** Sort direction. Defaults to "desc". */
  orderDirection?: "asc" | "desc";
}) {
  const {
    organizationId,
    page = 1,
    perPage = 8,
    search,
    orderBy = "createdAt",
    orderDirection = "desc",
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the items belonging to current org */
    const where: Prisma.LocationWhereInput = { organizationId };

    /** If the search string exists, match it across the text fields */
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { address: { contains: search, mode: "insensitive" } },
      ];
    }

    /**
     * orderBy is user-supplied via the URL. Guard against arbitrary values
     * reaching Prisma by restricting to known sort keys; otherwise fall back
     * to "createdAt".
     */
    const safeOrderBy = Object.prototype.hasOwnProperty.call(
      LOCATION_SORTING_OPTIONS,
      orderBy
    )
      ? orderBy
      : "createdAt";

    /**
     * orderDirection is also user-supplied via the URL (typed at the boundary
     * but not validated by getParamsValues). Normalize to a safe Prisma sort
     * order so a malformed value (e.g. "sideways") can't reach Prisma and 500
     * the index. Anything other than "asc" falls back to "desc".
     */
    const safeOrderDirection: Prisma.SortOrder =
      orderDirection === "asc" ? "asc" : "desc";

    /**
     * "Number of assets" sorts on a relation count, which requires the
     * _count shape rather than a scalar field. Post-pivot, asset placement
     * lives on the `AssetLocation` pivot — sort on its row count instead of
     * the removed implicit `assets` relation.
     */
    const orderByClause: Prisma.LocationOrderByWithRelationInput =
      safeOrderBy === "assets"
        ? { assetLocations: { _count: safeOrderDirection } }
        : { [safeOrderBy]: safeOrderDirection };

    const [locations, totalLocations] = await Promise.all([
      /** Get the items */
      db.location.findMany({
        skip,
        take,
        where,
        orderBy: orderByClause,
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
  // QT-aware: multiplies value × quantity so qty-tracked assets are not silently underreported.
  // Filter via the `AssetLocation` pivot — there is no `Asset.locationId`.
  // Prisma's `aggregate({_sum})` cannot express the multiplication, so we drop
  // to `$queryRaw` and keep the same scope (assets joined to the pivot).
  // Column is `value` (Asset.valuation is `@map("value")`). COALESCE
  // mirrors `getAssetTotalValue`. No `::bigint` cast — truncated floats.
  const rows = await db.$queryRaw<{ total: number | null }[]>(
    Prisma.sql`
      SELECT COALESCE(SUM(COALESCE(a.value, 0) * COALESCE(a.quantity, 1)), 0) AS total
      FROM "Asset" a
      WHERE a.id IN (
        SELECT al."assetId" FROM "AssetLocation" al
        WHERE al."locationId" = ${locationId}
      )
    `
  );

  return Number(rows[0]?.total ?? 0);
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

    // Use transaction to ensure location creation and activity event are atomic
    const created = await db.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: {
          name: name.trim(),
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

      // Activity event must be inside transaction for atomicity
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "LOCATION_CREATED",
          entityType: "LOCATION",
          entityId: location.id,
          locationId: location.id,
        },
        tx
      );

      return location;
    });

    return created;
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
    // Get the current location to check for changes
    const currentLocation = await db.location.findUniqueOrThrow({
      where: { id, organizationId },
      select: {
        name: true,
        description: true,
        address: true,
        latitude: true,
        longitude: true,
        parentId: true,
        parent: { select: { id: true, name: true } },
      },
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

    // Use transaction to ensure location update and activity event are atomic
    const updatedLocation = await db.$transaction(async (tx) => {
      const location = await tx.location.update({
        where: { id, organizationId },
        data: {
          name: name?.trim(),
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

      // Activity event must be inside transaction for atomicity
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "LOCATION_UPDATED",
          entityType: "LOCATION",
          entityId: id,
          locationId: id,
        },
        tx
      );

      return location;
    });

    // Create location activity notes for changed fields (not critical for atomicity)
    await createLocationEditNotes({
      locationId: id,
      userId,
      organizationId,
      previous: currentLocation,
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
  organizationId,
  previous,
  next,
}: {
  locationId: string;
  userId: string;
  organizationId: string;
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
      const newParent = await db.location.findFirst({
        where: { id: next.parentId, organizationId },
        select: { id: true, name: true },
      });
      newParentDisplay = newParent
        ? wrapLinkForNote(`/locations/${newParent.id}`, newParent.name)
        : "*unknown*";
    }

    changes.push(`- **Parent:** ${prevParent} → ${newParentDisplay}`);
  }

  if (changes.length === 0) return;

  const user = await db.user.findFirst({
    where: { id: userId },
    select: { firstName: true, lastName: true, displayName: true },
  });
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName: user?.firstName,
    lastName: user?.lastName,
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
    // first we get all the locations from the assets and make then into an object where the category is the key and the value is an empty string
    const locations = new Map(
      data
        .filter((asset) => asset.location)
        .map((asset) => [asset.location, ""])
    );

    // now we loop through the locations and check if they exist
    for (const [location, _] of locations) {
      const trimmedLocation = (location as string).trim();
      const existingLocation = await db.location.findFirst({
        where: {
          name: { equals: trimmedLocation, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingLocation) {
        // if the location doesn't exist, we create a new one
        const newLocation = await db.location.create({
          data: {
            name: trimmedLocation,
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
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: ids come from `locations` fetched above with `organizationId` in the where clause (lines 1062-1067), so they are already org-proven before this delete
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
          assetKits: {
            some: {
              asset: {
                bookingAssets: {
                  some: {
                    booking: {
                      custodianTeamMemberId: { in: teamMemberIds },
                      status: {
                        in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          assetKits: {
            some: {
              asset: {
                bookingAssets: {
                  some: {
                    booking: {
                      custodianUserId: { in: teamMemberIds },
                      status: {
                        in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                      },
                    },
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
                      displayName: true,
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

/**
 * Persists a system note on an asset describing a location add/change/remove.
 *
 * `organizationId` is required and forwarded to `createNote`, which asserts
 * the target asset belongs to that org before writing — preventing a caller
 * from attaching a note to another tenant's asset (cross-org IDOR).
 *
 * @param params.currentLocation - The asset's location before the change
 * @param params.newLocation - The asset's location after the change
 * @param params.firstName - Acting user's first name (for the note link)
 * @param params.lastName - Acting user's last name (for the note link)
 * @param params.assetId - The asset the note is written against
 * @param params.userId - The acting user's ID
 * @param params.isRemoving - Whether the location is being removed
 * @param params.organizationId - Caller's validated organization ID
 * @throws {ShelfError} If the asset is not in `organizationId` or the write fails
 */
export async function createLocationChangeNote({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetId,
  userId,
  isRemoving,
  organizationId,
  type,
  unitOfMeasure,
  quantity,
}: {
  currentLocation: Pick<Location, "id" | "name"> | null;
  newLocation: Pick<Location, "id" | "name"> | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
  organizationId: string;
  /** Asset type — only QUANTITY_TRACKED gets the "N units" phrasing. */
  type?: AssetType;
  /** Unit label for the count; defaults to "units". */
  unitOfMeasure?: string | null;
  /**
   * The affected per-row `AssetLocation.quantity` (units placed / moved /
   * removed at this location) — NOT `Asset.quantity`.
   */
  quantity?: number | null;
}) {
  try {
    const message = getLocationUpdateNoteContent({
      currentLocation,
      newLocation,
      userId,
      firstName,
      lastName,
      isRemoving,
      type,
      unitOfMeasure,
      quantity,
    });

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
      // why: scope the note's asset to the caller's org so a crafted
      // assetId cannot attach a note to another tenant's asset (IDOR)
      organizationId,
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
  organizationId,
  assetQuantities = {},
}: {
  // Assets have no direct `Asset.location` relation; placement is read
  // through the `AssetLocation` pivot. We surface the pivot's location
  // via `assetLocations.select.location` and read the primary placement
  // with `getPrimaryLocation` in the body below.
  //
  // `type` + `unitOfMeasure` drive the QUANTITY_TRACKED unit-count phrasing
  // in the per-asset note; the full pivot rows (`quantity` + `assetKitId` +
  // `locationId`) let us read the manual-row qty being removed at THIS
  // location without a second fetch.
  modifiedAssets: Prisma.AssetGetPayload<{
    select: {
      title: true;
      id: true;
      type: true;
      quantity: true;
      unitOfMeasure: true;
      assetLocations: {
        select: {
          locationId: true;
          quantity: true;
          assetKitId: true;
          location: {
            select: {
              name: true;
              id: true;
            };
          };
        };
      };
      user: {
        select: {
          firstName: true;
          lastName: true;
          displayName: true;
          id: true;
        };
      };
    };
  }>[];
  assetIds: Asset["id"][];
  removedAssetIds: Asset["id"][];
  userId: User["id"];
  location: Pick<Location, "id" | "name">;
  /** Caller's validated org — forwarded to each per-asset note for the IDOR guard */
  organizationId: string;
  /**
   * Per-asset submitted quantities from the location picker. Used to label
   * the QUANTITY_TRACKED unit count in the "placed N units" note. Mirrors
   * the createMany derivation in `updateLocationAssets`
   * (`assetQuantities[id] ?? Asset.quantity ?? 1`). Defaults to `{}` so
   * back-compat callers (mobile API) fall back to the asset's full pool.
   */
  assetQuantities?: Record<string, number>;
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
          displayName: true,
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
      const isQtyTracked = asset.type === AssetType.QUANTITY_TRACKED;
      const assetPrimaryLocation = getPrimaryLocation(asset);

      /**
       * INDIVIDUAL assets have at most one placement, so adding to L
       * implicitly relocates from their primary — render "moved from
       * primary to L" (or "set the location to L" if there was no
       * prior placement). For QUANTITY_TRACKED the picker adds a NEW
       * AssetLocation row at L while leaving any other manual rows
       * untouched, so referencing the primary in the note is wrong —
       * pass `currentLocation = null` and the helper renders "placed
       * N units at L".
       *
       * REMOVE path: the location being removed FROM is `location`
       * (the picker's context), not the asset's primary — for
       * INDIVIDUAL those are the same row anyway, but for
       * QUANTITY_TRACKED the primary may be a different (untouched)
       * placement. Always use `location` for the remove note.
       */
      let currentLocation: { id: string; name: string } | null = null;
      if (isRemoving) {
        currentLocation = { id: location.id, name: location.name };
      } else if (!isQtyTracked && assetPrimaryLocation) {
        currentLocation = {
          id: assetPrimaryLocation.id,
          name: assetPrimaryLocation.name,
        };
      }

      if (isNew || isRemoving) {
        // Affected per-row `AssetLocation.quantity` for the note count.
        // ADD: the qty written to the new pivot row (submitted picker value,
        // falling back to the asset's full pool) — mirrors the createMany in
        // `updateLocationAssets`. REMOVE: the MANUAL row qty dropped at THIS
        // location (kit-driven rows aren't touched by this flow). `null` for
        // INDIVIDUAL keeps the original phrasing via `formatUnitCount`.
        const affectedQuantity = isRemoving
          ? asset.assetLocations.find(
              (al) => al.locationId === location.id && al.assetKitId == null
            )?.quantity ?? null
          : assetQuantities[asset.id] ?? asset.quantity ?? null;

        await createLocationChangeNote({
          currentLocation,
          newLocation,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          assetId: asset.id,
          userId,
          isRemoving,
          // why: forward the caller's org so each per-asset note is
          // validated against the asset's true org (cross-org IDOR guard)
          organizationId,
          type: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          quantity: affectedQuantity,
        });

        if (isNew && newLocation) {
          addedAssets.push({ id: asset.id, title: asset.title });
        }

        if (isRemoving && currentLocation) {
          removedAssetsSummary.push({ id: asset.id, title: asset.title });
        }
      }
    }

    // Create summary notes on the location's activity log.
    // why: out of this rule — multi-asset popover, per-asset qty deferred.
    // The `buildAssetListMarkup` summary renders MANY assets in one
    // interactive chip; inlining per-asset unit counts here is the same
    // limitation as the assets_list popover. Per-asset counts land on the
    // individual asset notes above.
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    if (addedAssets.length > 0) {
      // Group added assets by their previous location for "Moved from" context
      const byPrevLoc = new Map<string, string>();
      for (const asset of modifiedAssets) {
        const prevLoc = getPrimaryLocation(asset);
        if (assetIds.includes(asset.id) && prevLoc) {
          byPrevLoc.set(prevLoc.id, prevLoc.name);
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
        const prevLoc = getPrimaryLocation(asset);
        if (!assetIds.includes(asset.id) || !prevLoc) continue;
        const existing = byPrevLocation.get(prevLoc.id);
        if (existing) {
          existing.assets.push({ id: asset.id, title: asset.title });
        } else {
          byPrevLocation.set(prevLoc.id, {
            name: prevLoc.name,
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

/**
 * Updates the assets placed at a given location, with optional per-asset
 * quantity for QUANTITY_TRACKED rows.
 *
 * Three diff branches are handled in a single transaction:
 *
 *  - **Add** (asset id in `assetIds` but not yet in the location's pivot
 *    rows): `tx.assetLocation.createMany` with `quantity =
 *    assetQuantities[assetId] ?? Asset.quantity ?? 1`.
 *  - **Remove** (asset id in `removedAssetIds`): `tx.assetLocation.deleteMany`.
 *  - **Qty edit** (asset id in `assetIds` AND already at this location AND
 *    submitted qty differs from the existing pivot row): per-row
 *    `tx.assetLocation.update` to set the new qty.
 *
 * Server-side strict-available re-validation runs BEFORE the transaction
 * using the **orthogonal MAX formula** (no custody / booking subtraction —
 * see `getLocationPickerMeta` for the rationale). The DEFERRED constraint
 * trigger `enforce_asset_location_sum_within_total` is the underlying
 * safety net at COMMIT; this re-validation just surfaces a clean 400
 * instead of a trigger-fired 500.
 *
 * @see {@link file://./picker-meta.server.ts} — `getLocationPickerMeta` uses the same formula
 * @see {@link file://./../../routes/_layout+/locations.$locationId.assets.manage-assets.tsx}
 */
export async function updateLocationAssets({
  assetIds,
  organizationId,
  locationId,
  userId,
  request,
  removedAssetIds,
  assetQuantities = {},
}: {
  assetIds: Asset["id"][];
  organizationId: Location["organizationId"];
  locationId: Location["id"];
  userId: User["id"];
  request: Request;
  removedAssetIds: Asset["id"][];
  /**
   * JSON map of QUANTITY_TRACKED asset id → submitted quantity from the
   * location manage-assets picker. INDIVIDUAL rows are absent; missing
   * entries fall back to `Asset.quantity` (full pool) for back-compat
   * with paths that don't expose the qty input yet (bulk + scan +
   * mobile API still call this helper without `assetQuantities`).
   */
  assetQuantities?: Record<string, number>;
}) {
  try {
    // Load the location alongside the assets currently placed at it via
    // the `AssetLocation` pivot. We need the assets list for ALL_SELECTED
    // expansion, to skip no-op connects below, and to detect qty edits
    // against the existing pivot rows.
    const location = await db.location
      .findUniqueOrThrow({
        where: {
          id: locationId,
          organizationId,
        },
        include: {
          assetLocations: {
            select: { assetId: true, quantity: true },
          },
        },
      })
      .catch((cause) => {
        // Only the genuine "record not found" path should become a
        // user-facing 404. Re-throw anything else so the outer try/catch
        // (or `makeShelfError`) can wrap it as a 5xx with capture enabled.
        if (isNotFoundError(cause)) {
          throw new ShelfError({
            cause,
            message: "Location not found",
            additionalData: { locationId, userId, organizationId },
            status: 404,
            label: "Location",
            shouldBeCaptured: false,
          });
        }
        throw cause;
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

      // Derive currently-placed asset IDs from the AssetLocation pivot.
      const locationAssets = location.assetLocations.map((al) => al.assetId);
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
     * SECURITY: every submitted asset ID (add or remove) must belong to the
     * caller's organization. Without this guard, Prisma's `connect`/`disconnect`
     * on `Location.assets` accepts cross-org IDs, silently reparenting another
     * workspace's asset to the caller's location (CWE-862).
     */
    await assertAssetsInOrganization({
      ids: Array.from(new Set([...assetIds, ...removedAssetIds])),
      organizationId,
      additionalData: { userId, locationId },
    });

    /**
     * Filter out assets already at this location - they don't need notes
     * since no actual change is happening for them. Existing placements
     * come from the pivot rows we loaded above (`location.assetLocations`).
     */
    const existingAssetIdQtyMap = new Map(
      location.assetLocations.map((al) => [al.assetId, al.quantity])
    );
    const existingAssetIds = new Set(existingAssetIdQtyMap.keys());
    const actuallyNewAssetIds = assetIds.filter(
      (id) => !existingAssetIds.has(id)
    );

    /**
     * Qty-edit set: assets already at this location whose submitted
     * quantity differs from the existing pivot row. The picker pre-fills
     * the qty input from `AssetLocation.quantity`, so a "no-op confirm"
     * surfaces here as an empty set — only genuine changes hit the DB.
     */
    const alreadyAtLocationIds = assetIds.filter((id) =>
      existingAssetIds.has(id)
    );
    const qtyEditedAssetIds = alreadyAtLocationIds.filter((id) => {
      const submitted = assetQuantities[id];
      if (submitted == null) return false;
      return existingAssetIdQtyMap.get(id) !== submitted;
    });

    /**
     * We need to query all the modified assets so we know their
     * location before the change so we can later create notes for all
     * the location changes, AND so we can run strict-available
     * re-validation for any qty-tracked submission.
     *
     * Select `type` + `quantity` (needed to compute the pivot row's
     * `quantity` on create) and the FULL `assetLocations` (locationId +
     * quantity, plus the nested `location.name/id` for the note text)
     * so the orthogonal-MAX formula can sum "other locations'" qty
     * without a second fetch.
     */
    const modifiedAssets = await db.asset
      .findMany({
        where: {
          id: {
            in: [
              ...actuallyNewAssetIds,
              ...removedAssetIds,
              ...qtyEditedAssetIds,
            ],
          },
          organizationId,
        },
        select: {
          title: true,
          id: true,
          type: true,
          quantity: true,
          // Labels the qty-tracked unit count in the per-asset location note
          // ("placed 50 boxes at …"). Selected here so the note builder
          // doesn't need a second fetch.
          unitOfMeasure: true,
          assetLocations: {
            select: {
              locationId: true,
              quantity: true,
              // Discriminate manual vs kit-driven so the sum-within-total
              // validator below can treat them correctly. Manual rows
              // at THIS location are editable; kit-driven rows at THIS
              // location aren't, but their qty still counts against
              // the asset's pool.
              assetKitId: true,
              location: {
                select: {
                  name: true,
                  id: true,
                },
              },
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
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

    /**
     * Strict-available re-validation for every qty-tracked submission.
     * Uses the orthogonal MAX formula:
     *
     *     spaceWithoutMe = Asset.quantity
     *                    − sum(rows at OTHER locations)
     *                    − sum(kit-driven rows at THIS location)
     *     max            = max(manualAtThisLocation, spaceWithoutMe)
     *
     * Kit-driven rows AT this location aren't being edited by the
     * picker (they're owned by the kit's flow) but their qty still
     * eats into the asset's total pool. They must be subtracted from
     * the picker's MAX explicitly — lumping them into "other
     * locations" overshoots reality and would surface as a generic
     * 500 from the DEFERRED sum-within-total trigger at COMMIT
     * instead of a clean 400 here.
     *
     * Why "max(manual, spaceWithoutMe)": if the asset is already
     * over-committed across locations, the picker shouldn't lock the
     * user out of submitting the existing manual slice — the DEFERRED
     * trigger is the ultimate guard. See {@link getLocationPickerMeta}
     * for the same formula.
     *
     * The submission set covers both new placements and qty edits;
     * INDIVIDUAL rows are skipped (their qty is always 1, no input).
     */
    const oversubscribed: Array<{
      assetId: string;
      title: string;
      submitted: number;
      max: number;
      breakdown: {
        total: number;
        otherLocations: number;
        kitDrivenAtThisLocation: number;
      };
    }> = [];
    const validateIds = new Set([...actuallyNewAssetIds, ...qtyEditedAssetIds]);
    for (const asset of modifiedAssets) {
      if (!validateIds.has(asset.id)) continue;
      if (asset.type !== AssetType.QUANTITY_TRACKED) continue;
      const submitted = assetQuantities[asset.id];
      if (submitted == null) continue;

      const totalQty = asset.quantity ?? 0;
      const otherLocationsQty = asset.assetLocations
        .filter((al) => al.locationId !== locationId)
        .reduce((sum, al) => sum + (al.quantity ?? 0), 0);
      // Kit-driven rows at this location (untouched by the picker but
      // still claiming part of the asset's pool). `== null` covers
      // both null and undefined so fixtures without `assetKitId` read
      // as manual.
      const kitDrivenAtThisLocation = asset.assetLocations
        .filter((al) => al.locationId === locationId && al.assetKitId != null)
        .reduce((sum, al) => sum + (al.quantity ?? 0), 0);
      // The manual row at this location is what the picker edits.
      const manualAtThisLocation =
        asset.assetLocations.find(
          (al) => al.locationId === locationId && al.assetKitId == null
        )?.quantity ?? 0;
      const spaceWithoutMe = Math.max(
        0,
        totalQty - otherLocationsQty - kitDrivenAtThisLocation
      );
      const max = Math.max(manualAtThisLocation, spaceWithoutMe);

      if (submitted > max) {
        oversubscribed.push({
          assetId: asset.id,
          title: asset.title,
          submitted,
          max,
          breakdown: {
            total: totalQty,
            otherLocations: otherLocationsQty,
            kitDrivenAtThisLocation,
          },
        });
      }
    }
    if (oversubscribed.length > 0) {
      const detail = oversubscribed
        .map((o) => {
          const parts: string[] = [];
          parts.push(`requested ${o.submitted}, max ${o.max}`);
          if (o.breakdown.kitDrivenAtThisLocation > 0) {
            parts.push(
              `${o.breakdown.kitDrivenAtThisLocation} via kits at this location`
            );
          }
          if (o.breakdown.otherLocations > 0) {
            parts.push(`${o.breakdown.otherLocations} placed elsewhere`);
          }
          parts.push(`total ${o.breakdown.total}`);
          return `${o.title} (${parts.join("; ")})`;
        })
        .join(". ");
      throw new ShelfError({
        cause: null,
        title: "Quantity exceeds available pool",
        message: `Submitted quantity exceeds the strict-available pool for: ${detail}.`,
        additionalData: {
          locationId,
          userId,
          organizationId,
          oversubscribed,
        },
        status: 400,
        label: "Location",
        shouldBeCaptured: false,
      });
    }

    // Use transaction to ensure all location updates and activity events are atomic
    /**
     * Cross-location MOVE for INDIVIDUAL assets — collected here so
     * the activity events below can carry the proper `fromValue`
     * (old location) instead of `null`. Computed pre-tx from the
     * `modifiedAssets` fetch which already includes each asset's
     * current `assetLocations`.
     *
     * An INDIVIDUAL asset is capped at one `AssetLocation` row by the
     * `enforce_individual_asset_single_location` BEFORE trigger. If
     * the user selects an INDIVIDUAL that's already at another
     * location, a naked `createMany` would trip the trigger and roll
     * back the whole tx with a generic check_violation. Instead, we
     * delete the asset's existing manual row inside the same tx so
     * the new row at this location passes the trigger. Mirror of the
     * cross-kit move at `updateKitAssets`.
     */
    const movedIndividualPriorLocations = new Map<
      string,
      { id: string; name: string }
    >();
    for (const asset of modifiedAssets) {
      if (!actuallyNewAssetIds.includes(asset.id)) continue;
      if (asset.type !== AssetType.INDIVIDUAL) continue;
      const priorRow = asset.assetLocations[0];
      if (!priorRow) continue;
      movedIndividualPriorLocations.set(asset.id, {
        id: priorRow.location.id,
        name: priorRow.location.name,
      });
    }
    const crossLocationMovedIds = Array.from(
      movedIndividualPriorLocations.keys()
    );

    await db.$transaction(async (tx) => {
      // Drop the prior manual row for each INDIVIDUAL being moved
      // across locations — done BEFORE the createMany below so the
      // INDIVIDUAL single-row trigger sees zero rows for these
      // assets when the new INSERT runs. Scoped to `assetKitId: null`
      // because INDIVIDUAL assets can't have kit-driven rows (the
      // trigger caps them at one row period). Defensive belt-and-
      // braces.
      if (crossLocationMovedIds.length > 0) {
        await tx.assetLocation.deleteMany({
          where: {
            assetId: { in: crossLocationMovedIds },
            assetKitId: null,
          },
        });
      }

      if (assetIds.length > 0) {
        /**
         * Connect-by-pivot. Build `AssetLocation` rows for every asset
         * being attached to this location. Quantity is the asset's
         * `quantity` for QUANTITY_TRACKED, otherwise 1 (matches the bulk
         * `updateAssetsWithNewLocation` pattern in
         * `asset/service.server.ts`).
         *
         * INDIVIDUALs that were moved across locations have already
         * had their prior row dropped above, so the new row at this
         * location passes the single-row trigger.
         */
        if (actuallyNewAssetIds.length > 0) {
          const newPivotRows = modifiedAssets
            .filter((a) => actuallyNewAssetIds.includes(a.id))
            .map((asset) => ({
              assetId: asset.id,
              locationId,
              organizationId,
              quantity:
                asset.type === AssetType.QUANTITY_TRACKED
                  ? assetQuantities[asset.id] ?? asset.quantity ?? 1
                  : 1,
            }));
          if (newPivotRows.length > 0) {
            await tx.assetLocation.createMany({
              data: newPivotRows,
              skipDuplicates: true,
            });
          }
        }
      }

      /**
       * Qty edits on already-placed pivot rows. One `update` per
       * affected (assetId, locationId) — bulk `updateMany` is no good
       * because each row gets its own qty. Mirrors the kit-side
       * `updateKitAssets` pattern.
       */
      if (qtyEditedAssetIds.length > 0) {
        for (const assetId of qtyEditedAssetIds) {
          const submitted = assetQuantities[assetId];
          if (submitted == null) continue;
          // Manual-row only. The (assetId, locationId) composite isn't
          // unique on its own (a manual + kit-driven row can coexist
          // at the same location), so we use `updateMany` scoped to
          // `assetKitId IS NULL`. The partial unique
          // `AssetLocation_manual_unique` ensures at most one matching
          // row per (assetId, locationId).
          await tx.assetLocation.updateMany({
            where: { assetId, locationId, assetKitId: null },
            data: { quantity: submitted },
          });
        }
      }

      /** If some assets were removed, we also need to handle those */
      if (removedAssetIds.length > 0) {
        // Disconnect-by-pivot. Drop the MANUAL `AssetLocation` rows
        // tying these assets to this location (kit-driven rows must
        // be managed through the kit's flow — they're untouched
        // here). Org scope is defense-in-depth; the location lookup
        // above already confirmed org ownership.
        await tx.assetLocation.deleteMany({
          where: {
            assetKitId: null,
            assetId: { in: removedAssetIds },
            locationId,
            organizationId,
          },
        });
      }

      // Asset lookup so each event can attach `meta.quantity` (qty-tracked
      // only) sourced from the per-row `AssetLocation.quantity` it touched.
      const assetById = new Map(modifiedAssets.map((a) => [a.id, a]));

      // Activity events — one ASSET_LOCATION_CHANGED per affected
      // asset, inside tx. For cross-location-moved INDIVIDUALs the
      // `fromValue` is the prior location id (not null) so reports
      // can render the move correctly.
      const locEvents: Parameters<typeof recordEvents>[0] = [
        ...actuallyNewAssetIds.map((assetId) => {
          const movedFrom = movedIndividualPriorLocations.get(assetId);
          const asset = assetById.get(assetId);
          // Placed qty = the value written to the new pivot row (mirrors the
          // createMany above). `assetQtyMeta` no-ops for INDIVIDUAL.
          const placedQty =
            assetQuantities[assetId] ?? asset?.quantity ?? undefined;
          return {
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: assetId,
            assetId,
            locationId,
            field: "locationId",
            fromValue: movedFrom?.id ?? null,
            toValue: locationId,
            ...(asset ? { meta: assetQtyMeta(asset, placedQty) } : {}),
          };
        }),
        ...removedAssetIds.map((assetId) => {
          const asset = assetById.get(assetId);
          // Removed qty = the MANUAL pivot row dropped at THIS location.
          const removedQty = asset?.assetLocations.find(
            (al) => al.locationId === locationId && al.assetKitId == null
          )?.quantity;
          return {
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: assetId,
            assetId,
            field: "locationId",
            fromValue: locationId,
            toValue: null,
            ...(asset ? { meta: assetQtyMeta(asset, removedQty) } : {}),
          };
        }),
      ];
      if (locEvents.length > 0) {
        await recordEvents(locEvents, tx);
      }
    });

    /** Creates the relevant notes for all the changed assets (not critical for atomicity) */
    await createBulkLocationChangeNotes({
      modifiedAssets,
      assetIds: actuallyNewAssetIds,
      removedAssetIds,
      userId,
      location,
      // why: assets were loaded scoped to organizationId — forward it so
      // each per-asset note is validated against the asset's true org
      organizationId,
      // Per-asset picker qty so the qty-tracked "placed N units" note count
      // matches the value written to the pivot row.
      assetQuantities,
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }
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
              assetKits: { select: { asset: { select: { id: true } } } },
            },
          },
        },
      })
      .catch((cause) => {
        // Only the genuine "record not found" path should become a
        // user-facing 404. Re-throw anything else so the outer try/catch
        // (or `makeShelfError`) can wrap it as a 5xx with capture enabled.
        if (isNotFoundError(cause)) {
          throw new ShelfError({
            cause,
            message: "Location not found",
            additionalData: { locationId, userId, organizationId },
            status: 404,
            label: "Location",
            shouldBeCaptured: false,
          });
        }
        throw cause;
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
          assetKits: { select: { asset: { select: { id: true } } } },
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
     * SECURITY: every submitted kit ID (add or remove) must belong to the
     * caller's organization. Without this guard, Prisma's `connect`/`disconnect`
     * on `Location.kits` accepts cross-org IDs, silently reparenting another
     * workspace's kit (and its cascading assets) to the caller's location
     * (CWE-862).
     */
    await assertKitsInOrganization({
      ids: Array.from(new Set([...kitIds, ...removedKitIds])),
      organizationId,
      additionalData: { userId, locationId },
    });

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
      location.kits.flatMap((kit) => kit.assetKits.map((ak) => ak.asset.id))
    );

    if (kitIds.length > 0) {
      // Get all asset IDs from the kits that are being added to this
      // location. Pull `type` + `quantity` on the kit's assets to compute
      // the new `AssetLocation.quantity`, and read each asset's previous
      // placement through the `assetLocations` pivot.
      const kitsToAdd = await db.kit.findMany({
        where: { id: { in: kitIds }, organizationId },
        select: {
          id: true,
          name: true,
          locationId: true,
          location: { select: { id: true, name: true } },
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  quantity: true,
                  assetLocations: {
                    select: {
                      location: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const assetIds = kitsToAdd.flatMap((kit) =>
        kit.assetKits.map((ak) => ak.asset.id)
      );

      /**
       * Kits remain a direct relation on Location, but assets are placed
       * via the `AssetLocation` pivot. We wrap the `kits.connect`
       * mutation and the pivot inserts in a single transaction so the
       * cascade is atomic. `skipDuplicates` matters because an asset
       * already placed at this location (e.g. added solo before its kit
       * was reparented) would violate `@@unique([assetId, locationId])`
       * — the no-op is the desired behaviour.
       */
      const flattenedKitAssets = kitsToAdd.flatMap((kit) => kit.assetKits);
      await db
        .$transaction(async (tx) => {
          await tx.location.update({
            where: {
              id: locationId,
              organizationId,
            },
            data: {
              kits: {
                connect: kitIds.map((id) => ({ id })),
              },
            },
          });

          if (flattenedKitAssets.length > 0) {
            // A kit being attached to this location should drive
            // kit-driven AssetLocation rows (`assetKitId` set) rather
            // than manual ones, so the "via kit" badge and the
            // kit-cascade flow downstream still work. Drop any
            // pre-existing kit-driven rows for these AssetKits (the
            // kit might be moving in from another location), then
            // create fresh kit-driven rows here.
            const newKitIds = kitsToAdd.map((k) => k.id);
            await tx.assetLocation.deleteMany({
              where: { assetKit: { kitId: { in: newKitIds } } },
            });
            const assetKitsForKits = await tx.assetKit.findMany({
              where: { kitId: { in: newKitIds } },
              select: { id: true, assetId: true, quantity: true },
            });
            if (assetKitsForKits.length > 0) {
              await tx.assetLocation.createMany({
                data: assetKitsForKits.map((ak) => ({
                  assetId: ak.assetId,
                  locationId,
                  organizationId,
                  quantity: ak.quantity,
                  assetKitId: ak.id,
                })),
              });
            }
          }
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
          displayName: true,
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

        // Build "Moved from" context for kits coming from other locations
        const actuallyNewKits = kitsToAdd.filter((kit) =>
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
            existing.kits.push({ id: kit.id, name: kit.name ?? kit.id });
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
        const allAssets = kitsToAdd
          .flatMap((kit) => kit.assetKits.map((ak) => ak.asset))
          .filter((asset) => !existingKitAssetIds.has(asset.id));

        // Create individual notes for each asset — previous placement
        // comes from the `AssetLocation` pivot.
        await Promise.all(
          allAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: getPrimaryLocation(asset),
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
              // why: asset belongs to a kit loaded scoped to
              // organizationId — pass the org so the note is validated
              // against the asset's true org (cross-org IDOR guard)
              organizationId,
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
          assetKits: {
            select: { asset: { select: { id: true, title: true } } },
          },
        },
      });

      const removedAssetIds = kitsBeingRemoved.flatMap((kit) =>
        kit.assetKits.map((ak) => ak.asset.id)
      );

      // Detach kits via the direct relation and drop the corresponding
      // `AssetLocation` pivot rows for the kit's assets, atomically in
      // one transaction.
      await db
        .$transaction(async (tx) => {
          await tx.location.update({
            where: {
              organizationId,
              id: locationId,
            },
            data: {
              kits: {
                disconnect: removedKitIds.map((id) => ({ id })),
              },
            },
          });

          if (removedAssetIds.length > 0) {
            // Only drop the kit-driven rows for the kits being
            // detached from this location. Manual rows the user
            // created at this location for the same assets survive.
            await tx.assetLocation.deleteMany({
              where: {
                assetKit: { kitId: { in: removedKitIds } },
                locationId,
                organizationId,
              },
            });
          }
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
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const allRemovedAssets = kitsBeingRemoved.flatMap((kit) =>
          kit.assetKits.map((ak) => ak.asset)
        );

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
              // why: asset belongs to a kit loaded scoped to
              // organizationId — pass the org so the note is validated
              // against the asset's true org (cross-org IDOR guard)
              organizationId,
            })
          )
        );
      }
    }
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the location kits.",
      additionalData: { locationId, kitIds },
      label,
    });
  }
}
