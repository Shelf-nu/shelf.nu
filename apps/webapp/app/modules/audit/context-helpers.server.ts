import { db } from "~/database/db.server";
import { getLocationDescendantIds } from "~/modules/location/descendants.server";
import { getLocationsWhereInput } from "~/modules/location/utils.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { assertLocationsBelongToOrg } from "~/utils/org-validation.server";

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
        shouldBeCaptured: false,
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

/**
 * Resolves the asset IDs to audit from a multi-select of locations on the
 * Locations index (the bulk "Create audit" action).
 *
 * - "Select all" (when `locationIds` contains {@link ALL_SELECTED_KEY}) resolves
 *   the full set of locations matching the current list filter, mirroring what
 *   the user sees — see {@link getLocationsWhereInput}.
 * - An explicit selection is proven to belong to the caller's org first (IDOR
 *   guard) before use.
 *
 * Asset→location is 1:1, so the union across locations needs no dedup. The
 * asset query is org-scoped, so a tampered/foreign location ID can never leak
 * another org's assets.
 *
 * @param organizationId - The caller's (validated) organization ID
 * @param locationIds - Selected location IDs (may contain ALL_SELECTED_KEY)
 * @param currentSearchParams - Serialized Locations-list search params (for select-all)
 * @returns Asset IDs across the selected locations
 * @throws {ShelfError} 400 if no locations resolve, or none of them contain assets
 */
export async function resolveAssetIdsForLocationSelection({
  organizationId,
  locationIds,
  currentSearchParams,
}: {
  organizationId: string;
  locationIds: string[];
  currentSearchParams?: string | null;
}): Promise<string[]> {
  // Resolve which locations to include in the audit
  let resolvedLocationIds: string[];

  if (locationIds.includes(ALL_SELECTED_KEY)) {
    // "Select all" — resolve the full filtered set (org-scoped by construction)
    const locations = await db.location.findMany({
      where: getLocationsWhereInput({ organizationId, currentSearchParams }),
      select: { id: true },
    });
    resolvedLocationIds = locations.map((location) => location.id);
  } else {
    // Explicit selection from request input — prove org ownership before use
    await assertLocationsBelongToOrg({ locationIds, organizationId });
    resolvedLocationIds = locationIds;
  }

  if (resolvedLocationIds.length === 0) {
    throw new ShelfError({
      cause: null,
      message: "No locations selected for the audit.",
      status: 400,
      label: "Audit",
      shouldBeCaptured: false,
    });
  }

  // Union of assets across the selected locations (asset→location is 1:1, so
  // findMany already returns each asset once — no dedup needed).
  const assets = await db.asset.findMany({
    where: { organizationId, locationId: { in: resolvedLocationIds } },
    select: { id: true },
  });

  if (assets.length === 0) {
    throw new ShelfError({
      cause: null,
      message:
        "None of the selected locations contain assets. Add assets before starting an audit.",
      status: 400,
      label: "Audit",
      shouldBeCaptured: false,
    });
  }

  return assets.map((asset) => asset.id);
}
