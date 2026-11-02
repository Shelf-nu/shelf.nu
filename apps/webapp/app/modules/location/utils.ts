import type { Location } from "@prisma/client";
import {
  wrapAssetsWithDataForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
} from "~/utils/markdoc-wrappers";

/**
 * Sort options exposed by the locations index <SortBy> dropdown.
 * Keys are valid sort fields; "assets" sorts by related-asset count.
 * Order here is the display order; "createdAt" is the default.
 *
 * Lives in this client-safe module (not service.server.ts) so the route's
 * client component can import it without pulling server-only code into the
 * browser bundle. The service imports it from here for its sort-field guard.
 */
export const LOCATION_SORTING_OPTIONS = {
  createdAt: "Date created",
  name: "Name",
  assets: "Number of assets",
} as const;

/**
 * Units of one asset that a location holds, for per-location value and
 * counts.
 *
 * An asset can have several `AssetLocation` rows at one location: at most one
 * manual row plus one kit-driven row per kit slice. The Location and Kit
 * axes describe the same physical units (each is capped at `Asset.quantity`
 * on its own), so a pool of 100 placed by hand here that also has a 50-unit
 * kit slice here still holds 100 units, not 150. The rows are summed and
 * capped at the stock.
 *
 * `getLocationTotalValuation` applies the same rule in SQL
 * (`LEAST(COALESCE(a.quantity, 1), SUM(al.quantity))`); keep the two in step.
 *
 * @param stock - `Asset.quantity`; null for INDIVIDUAL assets, which count as 1
 * @param placedQuantities - `AssetLocation.quantity` of every row for this asset at this location
 * @returns The units at this location, never more than the stock
 */
export function getUnitsAtLocation({
  stock,
  placedQuantities,
}: {
  stock: number | null;
  placedQuantities: number[];
}): number {
  const placed = placedQuantities.reduce((sum, quantity) => sum + quantity, 0);
  return Math.min(stock ?? 1, placed);
}

/** Helper to safely display a value, showing a dash if empty */
export function safeDisplay(value?: string | null) {
  return value?.trim() || "—";
}

/** Formats a location as a markdoc link for activity notes */
export function formatLocationLink(location: Pick<Location, "id" | "name">) {
  const name = safeDisplay(location.name);
  return wrapLinkForNote(`/locations/${location.id}`, name);
}

/** Builds a formatted list of assets for activity notes */
export function buildAssetListMarkup(
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
export function buildKitListMarkup(
  kits: Array<{ id: string; name: string }>,
  action: "added" | "removed"
) {
  const sanitized = kits.map((k) => ({
    id: k.id,
    name: safeDisplay(k.name),
  }));
  return wrapKitsWithDataForNote(sanitized, action);
}
