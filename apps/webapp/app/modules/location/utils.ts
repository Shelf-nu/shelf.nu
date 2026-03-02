import type { Location } from "@prisma/client";
import {
  wrapAssetsWithDataForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
} from "~/utils/markdoc-wrappers";

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
