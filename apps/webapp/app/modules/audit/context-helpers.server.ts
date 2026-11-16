import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { getKitsWhereInput } from "~/modules/kit/utils.server";
import { getLocationDescendantIds } from "~/modules/location/descendants.server";
import { getLocationsWhereInput } from "~/modules/location/utils.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  assertKitsBelongToOrg,
  assertLocationsBelongToOrg,
} from "~/utils/org-validation.server";

/** Context type for audit creation */
export type AuditContextType = "location" | "kit" | "user";

/**
 * The unit scope a new audit keeps in its `scopeMeta`, so a quantity-tracked
 * asset expects only the units inside it (see `auditUnitScope` in
 * `./quantity.ts`). Null for an audit of selected assets or of the index.
 */
export type AuditUnitScopeMeta =
  | { locationIds: string[] }
  | { kitIds: string[] }
  | { custodianUserId: string }
  | null;

/** The assets an audit covers and the unit scope it keeps. */
export type AuditAssetResolution = {
  assetIds: string[];
  unitScope: AuditUnitScopeMeta;
};

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
 * @returns The asset IDs to include in the audit, and the unit scope the
 *   context gives it (the location page's locations, the kit, the person)
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
}): Promise<AuditAssetResolution> {
  // If direct asset IDs are provided, use them
  if (directAssetIds && directAssetIds.length > 0) {
    return { assetIds: directAssetIds, unitScope: null };
  }

  // Otherwise, fetch assets based on context type. The asset queries are
  // org-scoped, so a foreign context id yields no assets and is refused below
  // before its scope is ever stored.
  if (contextType && contextId) {
    let resolution: AuditAssetResolution;

    switch (contextType) {
      case "location": {
        const { assetIds, locationIds } = await getAssetsForLocationContext({
          organizationId,
          locationId: contextId,
          includeChildLocations,
        });
        resolution = { assetIds, unitScope: { locationIds } };
        break;
      }
      case "kit":
        resolution = {
          assetIds: await getAssetsForKitContext({
            organizationId,
            kitId: contextId,
          }),
          unitScope: { kitIds: [contextId] },
        };
        break;
      case "user":
        resolution = {
          assetIds: await getAssetsForUserContext({
            organizationId,
            custodianUserId: contextId,
          }),
          unitScope: { custodianUserId: contextId },
        };
        break;
    }

    // Ensure there are assets to audit
    if (resolution.assetIds.length === 0) {
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

    return resolution;
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
 * The locations an audit started from one location page covers: that location,
 * plus all its descendants when child locations are included. Shared by the
 * asset selection and the expected-units scope so both cover the same places.
 *
 * @param organizationId - The organization ID to scope the descendant lookup
 * @param locationId - The location the audit was started from
 * @param includeChildLocations - Whether descendant locations are included
 * @returns The location IDs, the starting location first
 */
async function locationPageScope({
  organizationId,
  locationId,
  includeChildLocations,
}: {
  organizationId: string;
  locationId: string;
  includeChildLocations: boolean;
}): Promise<string[]> {
  if (!includeChildLocations) return [locationId];
  return getLocationDescendantIds({
    organizationId,
    locationId,
    includeSelf: true,
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
 * @returns The asset IDs at the location(s), and the locations covered
 */
export async function getAssetsForLocationContext({
  organizationId,
  locationId,
  includeChildLocations,
}: {
  organizationId: string;
  locationId: string;
  includeChildLocations: boolean;
}): Promise<{ assetIds: string[]; locationIds: string[] }> {
  const locationIds = await locationPageScope({
    organizationId,
    locationId,
    includeChildLocations,
  });

  // Fetch all assets at the specified location(s)
  const assets = await db.asset.findMany({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an audit started from a location covers everything placed there; audits keep archived assets and badge them
    where: {
      organizationId,
      assetLocations: { some: { locationId: { in: locationIds } } },
    },
    select: {
      id: true,
    },
  });

  return { assetIds: assets.map((asset) => asset.id), locationIds };
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
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an audit started from a kit covers every member, archived ones included (shown with a badge)
    where: {
      organizationId,
      assetKits: { some: { kitId } },
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
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an audit started from a user covers everything in their custody; audits keep archived assets and badge them
    where: {
      organizationId,
      custody: {
        some: {
          custodian: {
            userId: custodianUserId,
          },
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
 * - "Select all" (when `locationIds` contains {@link ALL_SELECTED_KEY}) matches
 *   assets whose location satisfies the current list filter, mirroring what the
 *   user sees — see {@link getLocationsWhereInput}. This uses a `location`
 *   relation filter so it stays a SINGLE query: no need to materialize the
 *   location IDs into a giant `IN (...)` list.
 * - An explicit selection is proven to belong to the caller's org first (IDOR
 *   guard), then scoped by the (deduped) location IDs.
 *
 * Asset→location is 1:1, so the result needs no dedup. The asset query is always
 * org-scoped, so a tampered/foreign location ID can never leak another org's
 * assets.
 *
 * @param organizationId - The caller's (validated) organization ID
 * @param locationIds - Selected location IDs (may contain ALL_SELECTED_KEY)
 * @param currentSearchParams - Serialized Locations-list search params (for select-all)
 * @returns Asset IDs across the selected locations, and the selected locations
 *   that hold them (the audit's unit scope)
 * @throws {ShelfError} 400 if none of the selected locations contain assets
 */
export async function resolveAssetIdsForLocationSelection({
  organizationId,
  locationIds,
  currentSearchParams,
}: {
  organizationId: string;
  locationIds: string[];
  currentSearchParams?: string | null;
}): Promise<{ assetIds: string[]; locationIds: string[] }> {
  // The placement filter for the selected locations. It selects the assets
  // and, applied to each asset's placements, names the selected locations that
  // hold them: the audit's unit scope, with no second location lookup.
  let placementWhere: Prisma.AssetLocationWhereInput;

  if (locationIds.includes(ALL_SELECTED_KEY)) {
    // "Select all" — match assets whose location satisfies the SAME filter the
    // user sees on the Locations list. Post-pivot, asset placement lives on the
    // `AssetLocation` pivot, so the relation filter goes through `assetLocations`
    // with a nested `location` where-clause.
    placementWhere = {
      location: getLocationsWhereInput({ organizationId, currentSearchParams }),
    };
  } else {
    // Explicit selection from request input — prove org ownership before use,
    // then scope by the deduped IDs (schema guarantees at least one). Asset →
    // location lookup goes via the `AssetLocation` pivot post-4b.
    await assertLocationsBelongToOrg({ locationIds, organizationId });
    placementWhere = { locationId: { in: [...new Set(locationIds)] } };
  }

  const assets = await db.asset.findMany({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an audit of selected locations covers everything placed there; audits keep archived assets and badge them
    where: { organizationId, assetLocations: { some: placementWhere } },
    select: {
      id: true,
      assetLocations: { where: placementWhere, select: { locationId: true } },
    },
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

  return {
    assetIds: assets.map((asset) => asset.id),
    locationIds: [
      ...new Set(
        assets.flatMap((asset) =>
          asset.assetLocations.map((placement) => placement.locationId)
        )
      ),
    ],
  };
}

/**
 * Resolves the asset IDs to audit from a multi-select of kits on the Kits index
 * (the bulk "Create audit" action).
 *
 * - "Select all" (when `kitIds` contains {@link ALL_SELECTED_KEY}) matches assets
 *   whose kit satisfies the current list filter, mirroring what the user sees —
 *   see {@link getKitsWhereInput} (which honors the Kits list `s` / `status` /
 *   `teamMember` filters). This uses a `kit` relation filter so it stays a
 *   SINGLE query: no need to materialize the kit IDs into a giant `IN (...)`
 *   list.
 * - An explicit selection is proven to belong to the caller's org first (IDOR
 *   guard), then scoped by the (deduped) kit IDs.
 *
 * Asset→kit is 1:1, so the result needs no dedup. The asset query is always
 * org-scoped, so a tampered/foreign kit ID can never leak another org's assets.
 *
 * @param organizationId - The caller's (validated) organization ID
 * @param kitIds - Selected kit IDs (may contain ALL_SELECTED_KEY)
 * @param currentSearchParams - Serialized Kits-list search params (for select-all)
 * @returns Asset IDs across the selected kits, and the selected kits that hold
 *   them (the audit's unit scope)
 * @throws {ShelfError} 400 if none of the selected kits contain assets
 */
export async function resolveAssetIdsForKitSelection({
  organizationId,
  kitIds,
  currentSearchParams,
}: {
  organizationId: string;
  kitIds: string[];
  currentSearchParams?: string | null;
}): Promise<{ assetIds: string[]; kitIds: string[] }> {
  // The membership filter for the selected kits. It selects the assets and,
  // applied to each asset's kit memberships, names the selected kits that hold
  // them: the audit's unit scope, with no second kit lookup.
  let membershipWhere: Prisma.AssetKitWhereInput;

  if (kitIds.includes(ALL_SELECTED_KEY)) {
    // "Select all" — match assets whose kit satisfies the SAME filter the user
    // sees on the Kits list. Post-pivot, asset → kit lookup goes via the
    // `AssetKit` pivot; surface the kit filter through the pivot relation.
    membershipWhere = {
      kit: getKitsWhereInput({
        organizationId,
        currentSearchParams,
        // Sole caller is `api+/audits.start`, gated on `audit: create`,
        // which BASE and SELF_SERVICE do not hold, so `?teamMember=` here
        // cannot come from a viewer restricted from seeing custody. Pass a
        // narrowed allow-list instead if this is ever called from an
        // `audit: read`/`update` route, which both restricted roles have.
        allowedTeamMemberIds: "all",
      }),
    };
  } else {
    // Explicit selection from request input — prove org ownership before use,
    // then scope by the deduped IDs (schema guarantees at least one). Post-pivot
    // the asset → kit join uses the `AssetKit` pivot.
    await assertKitsBelongToOrg({ kitIds, organizationId });
    membershipWhere = { kitId: { in: [...new Set(kitIds)] } };
  }

  const assets = await db.asset.findMany({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an audit of selected kits covers every member, archived ones included (shown with a badge)
    where: { organizationId, assetKits: { some: membershipWhere } },
    select: {
      id: true,
      assetKits: { where: membershipWhere, select: { kitId: true } },
    },
  });

  if (assets.length === 0) {
    throw new ShelfError({
      cause: null,
      message:
        "None of the selected kits contain assets. Add assets before starting an audit.",
      status: 400,
      label: "Audit",
      shouldBeCaptured: false,
    });
  }

  return {
    assetIds: assets.map((asset) => asset.id),
    kitIds: [
      ...new Set(
        assets.flatMap((asset) =>
          asset.assetKits.map((membership) => membership.kitId)
        )
      ),
    ],
  };
}
