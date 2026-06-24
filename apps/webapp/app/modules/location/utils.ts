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
