import { db } from "~/database/db.server";
import { getLocationDescendantIds } from "~/modules/location/descendants.server";
import { ShelfError } from "~/utils/error";

/** Context type for audit creation */
export type AuditContextType = "location" | "kit" | "user";

/**
 * Resolves asset IDs for audit creation from either direct input or context.
 * This is the main entry point used by the audit start API route.
 *
 * @param organizationId - The organization ID to scope the query
 * @param directAssetIds - Asset IDs passed directly (from bulk selection)
 * @param contextType - Type of context (location, kit, user)
 * @param contextId - ID of the context entity
 * @param contextName - Display name for error messages
 * @param includeChildLocations - For locations, whether to include child locations
 * @returns Array of asset IDs to include in the audit
 */
export async function resolveAssetIdsForAudit({
  organizationId,
  directAssetIds,
  contextType,
  contextId,
  contextName,
  includeChildLocations,
}: {
  organizationId: string;
  directAssetIds?: string[];
  contextType?: AuditContextType;
  contextId?: string;
  contextName?: string;
  includeChildLocations: boolean;
}): Promise<string[]> {
  // If direct asset IDs are provided, use them
  if (directAssetIds && directAssetIds.length > 0) {
    return directAssetIds;
  }

  // Otherwise, fetch assets based on context type
  if (contextType && contextId) {
    let assetIds: string[];

    switch (contextType) {
      case "location":
        assetIds = await getAssetsForLocationContext({
          organizationId,
          locationId: contextId,
          includeChildLocations,
        });
        break;
      case "kit":
        assetIds = await getAssetsForKitContext({
          organizationId,
          kitId: contextId,
        });
        break;
      case "user":
        assetIds = await getAssetsForUserContext({
          organizationId,
          custodianUserId: contextId,
        });
        break;
    }

    // Ensure there are assets to audit
    if (assetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        message: `No assets found in ${contextType} "${
          contextName || contextId
        }". Add assets before starting an audit.`,
        status: 400,
        label: "Audit",
      });
    }

    return assetIds;
  }

  // This shouldn't happen due to schema validation, but handle it anyway
  throw new ShelfError({
    cause: null,
    message: "Either assetIds or context parameters must be provided",
    status: 400,
    label: "Audit",
  });
}

/**
 * Fetches all asset IDs for a given location context.
 * Used for starting audits from a location page where all assets
 * at that location (and optionally child locations) should be included.
 *
 * @param organizationId - The organization ID to scope the query
 * @param locationId - The location ID to fetch assets from
 * @param includeChildLocations - Whether to include assets from all descendant locations
 * @returns Array of asset IDs at the specified location(s)
 */
export async function getAssetsForLocationContext({
  organizationId,
  locationId,
  includeChildLocations,
}: {
  organizationId: string;
  locationId: string;
  includeChildLocations: boolean;
}): Promise<string[]> {
  // Determine which location IDs to query based on includeChildLocations flag
  let locationIds: string[];

  if (includeChildLocations) {
    // Get all descendant location IDs (including the parent location itself)
    locationIds = await getLocationDescendantIds({
      organizationId,
      locationId,
      includeSelf: true,
    });
  } else {
    // Only query the single location
    locationIds = [locationId];
  }

  // Fetch all assets at the specified location(s)
  const assets = await db.asset.findMany({
    where: {
      organizationId,
      locationId: { in: locationIds },
    },
    select: {
      id: true,
    },
  });

  // Return just the asset IDs
  return assets.map((asset) => asset.id);
}

/**
 * Fetches all asset IDs for a given kit context.
 * Used for starting audits from a kit page where all assets
 * in that kit should be included.
 *
 * @param organizationId - The organization ID to scope the query
 * @param kitId - The kit ID to fetch assets from
 * @returns Array of asset IDs in the specified kit
 */
export async function getAssetsForKitContext({
  organizationId,
  kitId,
}: {
  organizationId: string;
  kitId: string;
}): Promise<string[]> {
  // Fetch all assets assigned to the kit
  const assets = await db.asset.findMany({
    where: {
      organizationId,
      kitId,
    },
    select: {
      id: true,
    },
  });

  // Return just the asset IDs
  return assets.map((asset) => asset.id);
}

/**
 * Fetches all asset IDs for a given user custody context.
 * Used for starting audits from a user page where all assets
 * in that user's custody should be included.
 *
 * @param organizationId - The organization ID to scope the query
 * @param custodianUserId - The user ID whose custody assets to fetch
 * @returns Array of asset IDs in the user's custody
 */
export async function getAssetsForUserContext({
  organizationId,
  custodianUserId,
}: {
  organizationId: string;
  custodianUserId: string;
}): Promise<string[]> {
  // Fetch all assets where the user is the current custodian
  const assets = await db.asset.findMany({
    where: {
      organizationId,
      custody: {
        custodian: {
          userId: custodianUserId,
        },
      },
    },
    select: {
      id: true,
    },
  });

  // Return just the asset IDs
  return assets.map((asset) => asset.id);
}
