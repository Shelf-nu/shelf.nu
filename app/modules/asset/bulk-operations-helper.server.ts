import type { Asset, AssetIndexSettings } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { getParamsValues, ALL_SELECTED_KEY } from "~/utils/list";
import { generateWhereClause, parseFiltersWithHierarchy } from "./query.server";
import { getAssetsWhereInput } from "./utils.server";
import type { Column } from "../asset-index-settings/helpers";

const label = "Assets";

/**
 * Gets asset IDs matching advanced filters - optimized for bulk operations
 *
 * Uses the same filter parsing and where clause generation as the advanced
 * paginated query, but returns only IDs without expensive joins/aggregations.
 *
 * NOTE: Still requires the same LEFT JOINs as main query because
 * generateWhereClause can reference joined tables (e.g., c.name, t.id, tm.name)
 *
 * @param organizationId - Organization to scope query
 * @param filters - URL search params string with advanced filters
 * @param settings - Asset index settings with columns configuration
 * @param availableToBookOnly - Filter to bookable assets only (for self-service)
 * @returns Promise resolving to array of asset IDs matching the filters
 */
async function getAdvancedFilteredAssetIds({
  organizationId,
  filters,
  settings,
  availableToBookOnly = false,
}: {
  organizationId: string;
  filters: string;
  settings: AssetIndexSettings;
  availableToBookOnly?: boolean;
}): Promise<string[]> {
  try {
    const searchParams = new URLSearchParams(filters);
    const paramsValues = getParamsValues(searchParams);
    const { search } = paramsValues;

    const settingColumns = settings.columns as Column[];
    const parsedFilters = await parseFiltersWithHierarchy(
      filters,
      settingColumns,
      organizationId
    );

    // Generate WHERE clause (reuses existing logic)
    const whereClause = generateWhereClause(
      organizationId,
      search,
      parsedFilters,
      undefined, // no specific assetIds filter
      availableToBookOnly
    );

    // Minimal query: only SELECT id, but include necessary joins
    // Joins are needed because WHERE clause may reference: c.name, l.name, t.id, tm.name, etc.
    const query = Prisma.sql`
      SELECT DISTINCT a.id
      FROM public."Asset" a
      LEFT JOIN public."Category" c ON a."categoryId" = c.id
      LEFT JOIN public."Location" l ON a."locationId" = l.id
      LEFT JOIN public."_AssetToTag" att ON a.id = att."A"
      LEFT JOIN public."Tag" t ON att."B" = t.id
      LEFT JOIN public."Custody" cu ON cu."assetId" = a.id
      LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
      LEFT JOIN public."User" u ON tm."userId" = u.id
      ${whereClause}
    `;

    const results = await db.$queryRaw<Array<{ id: string }>>(query);
    return results.map((r) => r.id);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching asset IDs",
      additionalData: { organizationId, filters, availableToBookOnly },
      label,
    });
  }
}

/**
 * Resolves asset IDs for bulk operations in both simple and advanced modes
 *
 * This is the single source of truth for determining which assets to operate on
 * when performing bulk operations. It handles three scenarios:
 *
 * 1. Specific selection: Returns provided IDs as-is
 * 2. Select all (simple mode): Queries with simple filters (status, category, tags, etc.)
 * 3. Select all (advanced mode): Queries with advanced filters (custom fields, operators)
 *
 * @param assetIds - Array of asset IDs (may contain ALL_SELECTED_KEY)
 * @param organizationId - Organization ID to scope query
 * @param currentSearchParams - URL search params string with active filters
 * @param settings - Asset index settings (determines mode and columns)
 * @returns Promise resolving to array of asset IDs to operate on
 *
 * @example
 * // Specific selection
 * const ids = await resolveAssetIdsForBulkOperation({
 *   assetIds: ["id1", "id2", "id3"],
 *   organizationId,
 *   currentSearchParams: null,
 *   settings,
 * });
 * // Returns: ["id1", "id2", "id3"]
 *
 * @example
 * // Select all with filters in advanced mode
 * const ids = await resolveAssetIdsForBulkOperation({
 *   assetIds: ["all-selected"],
 *   organizationId,
 *   currentSearchParams: "cf_SerialNumber=contains:ABC&status=is:AVAILABLE",
 *   settings: { mode: "ADVANCED", columns: [...] },
 * });
 * // Returns: ["id1", "id5", "id12"] // All assets matching filters
 */
export async function resolveAssetIdsForBulkOperation({
  assetIds,
  organizationId,
  currentSearchParams,
  settings,
}: {
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}): Promise<string[]> {
  // Case 1: Specific selection - return IDs as-is
  if (!assetIds.includes(ALL_SELECTED_KEY)) {
    return assetIds;
  }

  // Case 2: Select all - use mode from settings
  // IMPORTANT: We must respect settings.mode as the source of truth
  // If someone has advanced syntax in URL but settings say SIMPLE,
  // we ignore the advanced filters (they may be from old bookmark/shared link)
  const isAdvancedMode = settings.mode === "ADVANCED";

  if (isAdvancedMode && currentSearchParams) {
    // ADVANCED MODE: Use dedicated function for advanced filters
    return getAdvancedFilteredAssetIds({
      organizationId,
      filters: currentSearchParams,
      settings,
      availableToBookOnly: false, // Set based on user role if needed
    });
  } else {
    // SIMPLE MODE: Use simple where clause
    // Note: getAssetsWhereInput will safely ignore any advanced filter syntax
    const where = getAssetsWhereInput({
      organizationId,
      currentSearchParams,
    });

    const assets = await db.asset.findMany({
      where,
      select: { id: true },
    });

    return assets.map((a) => a.id);
  }
}
