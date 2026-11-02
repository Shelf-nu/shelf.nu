import type { Asset, AssetIndexSettings } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getParamsValues, ALL_SELECTED_KEY } from "~/utils/list";
import {
  LAST_AUDIT_DATE_COLUMN,
  canQueryLastAuditDate,
} from "./last-audit-date-access";
import type { LastAuditDateAccess } from "./last-audit-date-access";
import type { BookableListScope } from "./list-scope.server";
import { getAssetListWhereForSelectAll } from "./list-where.server";
import {
  detectPoolKeys,
  generateWhereClause,
  parseFiltersWithHierarchy,
  POOL_AGGREGATE_JOIN,
} from "./query.server";
import type { AllowedCustodianFilterIds } from "./utils.server";
import { getArchivedFilterFromParams } from "./utils.server";
import type { Column } from "../asset-index-settings/helpers";

const label = "Assets";

/**
 * Builds the raw SQL that resolves asset IDs for an advanced-filter bulk
 * operation. Kept separate so the join/column shape is unit-testable without a
 * DB: raw SQL can't be typechecked, so a string assertion is the regression
 * guard (see `.claude/rules/raw-sql-respects-prisma-map.md` and the co-located
 * test).
 *
 * The joins mirror the main paginated query because {@link generateWhereClause}
 * may reference the joined aliases (c.name, l.name, t.id, tm.name, ...). Asset
 * placement lives on the `AssetLocation` pivot (there is no `Asset.locationId`
 * column), so location is joined via a LATERAL primary-pick (oldest pivot row),
 * exactly like the index query.
 *
 * @param whereClause - The `Prisma.Sql` WHERE fragment from generateWhereClause.
 * @param options.withPool - Whether `whereClause` may reference the `pool`
 *   LATERAL (a Free now / Reserved / Stock status filter, or the low stock
 *   toggle). Adds {@link POOL_AGGREGATE_JOIN} when `true`.
 * @returns The composed `Prisma.Sql` SELECT query.
 */
export function buildAdvancedFilteredAssetIdsQuery(
  whereClause: Prisma.Sql,
  { withPool }: { withPool: boolean }
): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT a.id
    FROM public."Asset" a
    LEFT JOIN public."Category" c ON a."categoryId" = c.id
    -- Placement lives on the AssetLocation pivot (no Asset.locationId FK).
    -- LATERAL primary-pick yields one location per asset so the search
    -- clause's l.name reference resolves without row fan-out.
    LEFT JOIN LATERAL (
      SELECT l.id, l.name, l."parentId"
      FROM public."AssetLocation" al
      JOIN public."Location" l ON al."locationId" = l.id
      WHERE al."assetId" = a.id
      ORDER BY al."createdAt" ASC, al.id ASC
      LIMIT 1
    ) l ON TRUE
    LEFT JOIN public."_AssetToTag" att ON a.id = att."A"
    LEFT JOIN public."Tag" t ON att."B" = t.id
    LEFT JOIN public."Custody" cu ON cu."assetId" = a.id
    LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
    LEFT JOIN public."User" u ON tm."userId" = u.id
    -- The pool aggregates the index query uses, required exactly when the
    -- WHERE may reference pool.*: without them that WHERE fails with
    -- "missing FROM-clause entry for table pool", and with them every asset
    -- pays five correlated aggregates the WHERE never reads.
    ${withPool ? POOL_AGGREGATE_JOIN : Prisma.empty}
    ${whereClause}
  `;
}

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
 * @param bookableScope - The caller's list scope; `null` selects every asset.
 *   Applied in the same SQL the advanced index uses, so select-all matches the
 *   rows a Base or Self Service member was shown.
 * @param timeZone - Acting user's IANA timezone; forwarded to
 *   {@link generateWhereClause} so built-in date-column filters truncate the
 *   day in the user's tz (avoids an off-by-one). Defaults to "UTC".
 * @param honorArchivedView - Apply the `?archived=` view; otherwise active
 *   assets only. See {@link resolveAssetIdsForBulkOperation}.
 * @param lastAuditDateAccess - How the caller may use the last audit date. A
 *   `lastAuditDate` filter without `available` access refuses the selection.
 * @returns Promise resolving to array of asset IDs matching the filters
 * @throws {ShelfError} 400 when the selection carries a last audit date filter
 *   the caller may not use
 */
async function getAdvancedFilteredAssetIds({
  organizationId,
  filters,
  settings,
  bookableScope,
  timeZone = "UTC",
  honorArchivedView = false,
  lastAuditDateAccess,
}: {
  organizationId: string;
  filters: string;
  settings: AssetIndexSettings;
  bookableScope: BookableListScope | null;
  timeZone?: string;
  honorArchivedView?: boolean;
  lastAuditDateAccess: LastAuditDateAccess;
}): Promise<string[]> {
  try {
    const searchParams = new URLSearchParams(filters);
    const paramsValues = getParamsValues(searchParams);
    const { search } = paramsValues;
    // "Low stock" quick filter toggle — must be forwarded here too so
    // "select all" (ALL_SELECTED_KEY) matches the same rows the index shows.
    const lowStockOnly = searchParams.get("lowStockOnly") === "true";

    const settingColumns = settings.columns as Column[];
    const parsedFilters = await parseFiltersWithHierarchy(
      filters,
      settingColumns,
      organizationId
    );

    // A last audit date filter from a caller who may not query it would turn
    // "select all" into an audit-date oracle. Refuse the whole selection;
    // dropping the filter would widen the bulk action beyond what was shown.
    // It is an error, not an empty selection: the index drops the same filter
    // and shows every asset, so an empty result would let a bulk action report
    // success while changing nothing.
    if (
      !canQueryLastAuditDate(lastAuditDateAccess) &&
      parsedFilters.some((f) => f.name === LAST_AUDIT_DATE_COLUMN)
    ) {
      throw new ShelfError({
        cause: null,
        title: "Filter not available",
        message:
          "The last audit date filter is not available in this workspace. Remove it from the URL and try again.",
        additionalData: { organizationId, lastAuditDateAccess },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // Generate WHERE clause (reuses existing logic)
    const whereClause = generateWhereClause(
      organizationId,
      search,
      parsedFilters,
      undefined, // no specific assetIds filter
      bookableScope,
      timeZone,
      lowStockOnly,
      // The Active/Archived view, only for callers that opt in (issue #382);
      // everyone else selects active assets whatever the URL says.
      honorArchivedView ? getArchivedFilterFromParams(searchParams) : "active"
    );

    // Minimal query: only SELECT id, but include the same joins the main
    // paginated query uses, because the WHERE clause may reference joined
    // aliases (c.name, l.name, t.id, tm.name, etc.).
    // Same gate as the index's cheap phase: the WHERE reads pool.* only for
    // the low stock toggle or a pool column filter. No sort applies here.
    const query = buildAdvancedFilteredAssetIdsQuery(whereClause, {
      withPool: lowStockOnly || detectPoolKeys(parsedFilters, []),
    });

    const results = await db.$queryRaw<Array<{ id: string }>>(query);
    return results.map((r) => r.id);
  } catch (cause) {
    // Keep a deliberate refusal's status and message.
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching asset IDs",
      additionalData: { organizationId, filters, bookableScope },
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
 * @param timeZone - Acting user's IANA timezone; forwarded to the advanced
 *   filter query so built-in date-column filters truncate the day in the
 *   user's tz (avoids an off-by-one). Defaults to "UTC".
 * @param lastAuditDateAccess - How the caller may use the last audit date
 * @param bookableScope - The caller's list scope, `null` for a member who sees
 *   every asset
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
  timeZone = "UTC",
  allowedTeamMemberIds,
  lastAuditDateAccess,
  bookableScope,
  honorArchivedView = false,
}: {
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
  timeZone?: string;
  /**
   * Resolve "select all" in the `?archived=` view the user was looking at
   * (issue #382). Off by default, so select-all acts on active assets: the
   * view param is raw URL input, and a list only honours it for members who
   * may see archived assets. Pass `true` only from bulk actions that work ON
   * archived assets and are themselves gated to those members (archive,
   * reinstate, delete), or for a caller proven to hold `asset: archive`.
   */
  honorArchivedView?: boolean;
  /**
   * Custodian ids the caller may filter by. Required, with no default, so
   * every bulk operation states an answer — "select all" resolves through
   * caller-supplied filters, and a custodian filter turns that into a way to
   * read back exactly which assets a named colleague holds.
   */
  allowedTeamMemberIds: AllowedCustodianFilterIds;
  /**
   * How the caller may use the last audit date. Required, with no default, for
   * the same reason as `allowedTeamMemberIds`: "select all" resolves through
   * caller-supplied filters, and an audit date filter would reveal audit data
   * to a caller who may not see it. Resolve it with `lastAuditDateAccessFor`.
   */
  lastAuditDateAccess: LastAuditDateAccess;
  /**
   * The caller's list scope, from `resolveBookableListScope({ access, userId })`:
   * `null` for members who see every asset. Required, with no default, so
   * every caller states an answer: a Base or Self Service member's list hides
   * assets outside their scope, and "select all" must not reach them either.
   */
  bookableScope: BookableListScope | null;
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
    /**
     * The advanced syntax carries its own custodian filter (`custody:is:…`),
     * which never passes through the simple-mode list where, so the allow-list
     * has to be honoured separately here.
     *
     * `/assets` flips a restricted role's saved mode back to SIMPLE, but only
     * when they actually visit it; a demoted user whose stored mode is still
     * ADVANCED reaches this branch by calling a bulk endpoint directly. Refuse
     * the whole selection rather than silently dropping the filter, which would
     * widen it to every asset in the workspace.
     */
    if (
      allowedTeamMemberIds !== "all" &&
      new URLSearchParams(currentSearchParams).has("custody")
    ) {
      return [];
    }

    // ADVANCED MODE: Use dedicated function for advanced filters. The list
    // scope goes into the same `generateWhereClause` the advanced index uses.
    return getAdvancedFilteredAssetIds({
      organizationId,
      filters: currentSearchParams,
      settings,
      bookableScope,
      timeZone,
      honorArchivedView,
      lastAuditDateAccess,
    });
  } else {
    // SIMPLE MODE: the simple index's own where, built from the same URL and
    // options as its loader, so select-all matches the rows the list showed.
    // Every bulk action comes from the /assets index, whose loader honours the
    // low stock toggle. Advanced syntax in a stale URL is read the way the
    // simple list reads it: a non-enum `status` (such as `is:AVAILABLE`) is
    // ignored, params the simple list has no filter for (custom fields,
    // `custody`, `tags`) are ignored, and an operator value under a shared
    // key (`category=is:x`, `location=is:x`) is matched as a literal id, so
    // it selects nothing, exactly as the list would show nothing.
    const where = await getAssetListWhereForSelectAll({
      organizationId,
      currentSearchParams,
      allowedTeamMemberIds,
      bookableScope,
      locationIdsOverride: undefined,
      honorArchivedView,
      honorLowStockFilter: true,
    });

    const assets = await db.asset.findMany({
      where,
      select: { id: true },
    });

    return assets.map((a) => a.id);
  }
}
