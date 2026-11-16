/**
 * Links Into The Filtered Asset Index
 *
 * Builds `/assets` URLs that open the index already narrowed to one value, for
 * pages that drill into it (a category's asset count, for example).
 *
 * The two index modes read filters in different grammars: the simple index
 * takes `category=<id>`, the advanced index takes `category=is:<id>`. This
 * helper writes the grammar of the mode the viewer will land in.
 *
 * Dependency-free so route components can import it.
 *
 * `buildAssetsFilterHref` (`components/assets/assets-filter-link.tsx`) builds
 * the same links in the simple grammar alone: the advanced index promotes a
 * bare value to `is:` (`normalizeAdvancedFilterParams`), so both modes read it.
 *
 * @see {@link file://./../asset/filter-param.ts} the advanced `operator:value` grammar
 * @see {@link file://./service.server.ts} `getAssetIndexModeForUser`
 */
import type { AssetIndexMode } from "@prisma/client";

/** Arguments for {@link buildAssetIndexFilterHref} */
type BuildAssetIndexFilterHrefArgs = {
  /** The mode the viewer's asset index opens in */
  mode: AssetIndexMode;
  /** The filter parameter, shared by both modes (e.g. `category`) */
  key: string;
  /** The value to match exactly (e.g. a category id) */
  value: string;
};

/**
 * Builds an `/assets` URL filtered to a single exact value.
 *
 * @param args - See {@link BuildAssetIndexFilterHrefArgs}
 * @returns A relative URL, e.g. `/assets?category=is%3Aabc` in advanced mode
 */
export function buildAssetIndexFilterHref({
  mode,
  key,
  value,
}: BuildAssetIndexFilterHrefArgs): string {
  const params = new URLSearchParams({
    [key]: mode === "ADVANCED" ? `is:${value}` : value,
  });
  return `/assets?${params.toString()}`;
}
