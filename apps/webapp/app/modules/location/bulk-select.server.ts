import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { getLocationKitsWhereInput } from "./utils.server";

/**
 * The filters the user had applied, taken from the submitted form.
 *
 * These deliberately do NOT come from `request.url`. The bulk dialogs post to a
 * bare `actionUrl` (`/locations/:id/assets`), so inside the action `request.url`
 * carries no query string at all — reading filters from it yields an empty set
 * and turns "select all" into "select everything at this location". The dialog
 * submits the real filters as a `currentSearchParams` field; that is the only
 * source that reflects what the user was actually looking at.
 */
type WithSearchParams = { currentSearchParams?: string | null };

/**
 * Resolves asset IDs for bulk location operations.
 * Handles ALL_SELECTED_KEY expansion using asset filters + the
 * `AssetLocation` pivot to scope to a single location.
 *
 * "Select all" must mean the rows the list showed, so the expansion follows the
 * list's Active / Archived / All view the same way its loader does.
 */
export async function resolveLocationAssetIds({
  ids,
  organizationId,
  locationId,
  currentSearchParams,
  honorArchivedView,
}: {
  ids: string[];
  organizationId: string;
  locationId: string;
  /**
   * Apply the `?archived=` view from `currentSearchParams`. Pass
   * `canViewArchivedAssets(access)`, the grant the list's loader uses; without
   * it the expansion covers active assets only.
   */
  honorArchivedView: boolean;
} & WithSearchParams): Promise<string[]> {
  if (!ids.includes(ALL_SELECTED_KEY)) {
    return ids;
  }

  const assetsWhere = getAssetsWhereInput({
    organizationId,
    currentSearchParams,
    // Location writes are ADMIN/OWNER-only, so the custodian filter
    // here can never come from a restricted viewer.
    allowedTeamMemberIds: "all",
    honorArchivedView,
  });

  const allAssets = await db.asset.findMany({
    where: {
      ...assetsWhere,
      // Match assets that have an `AssetLocation` pivot row at this location.
      assetLocations: { some: { locationId } },
    },
    select: { id: true },
  });

  return allAssets.map((a) => a.id);
}

/**
 * Resolves kit IDs for bulk location operations.
 * Handles ALL_SELECTED_KEY expansion using kit filters + locationId.
 */
export async function resolveLocationKitIds({
  ids,
  organizationId,
  locationId,
  currentSearchParams,
}: {
  ids: string[];
  organizationId: string;
  locationId: string;
} & WithSearchParams): Promise<string[]> {
  if (!ids.includes(ALL_SELECTED_KEY)) {
    return ids;
  }

  /**
   * Uses the location kit list's own builder, not `getKitsWhereInput`.
   *
   * The two disagree: this page's custodian dropdown offers "Without custody"
   * and matches custody-by-user and running-booking custody, none of which the
   * kits-index builder knows. Sending `teamMember=without-custody` through that
   * builder produced `custody.custodianId = "without-custody"` — an id nobody
   * holds — so select-all resolved zero kits and reported success while the
   * user was looking at rows.
   *
   * Widening the shared kits-index builder was the wrong fix: `bulkDeleteKits`
   * uses it too, and the kits index does not offer these options.
   */
  const searchParams = new URLSearchParams(currentSearchParams ?? "");
  const { search, teamMemberIds } = getParamsValues(searchParams);

  const allKits = await db.kit.findMany({
    where: getLocationKitsWhereInput({
      organizationId,
      locationId,
      search,
      teamMemberIds,
    }),
    select: { id: true },
  });

  return allKits.map((k) => k.id);
}
