import type { Prisma } from "@prisma/client";
import { resolveAssetSearchIds } from "~/modules/asset/search-ids.server";
import { splitAssetSearchTerms } from "~/modules/asset/search.server";

/**
 * Search resolution for the mobile assets list
 * (routes/api+/mobile+/assets.ts).
 *
 * Resolves the search term to a Prisma where-fragment via the shared
 * org-scoped UNION (`buildAssetSearchUnion`) — the same index-driven,
 * org-scoped path the web `getAssets` fetcher and the advanced index use,
 * replacing the old Prisma multi-table OR + narrow/fallback two-query dance.
 * Mobile search therefore matches exactly the same 10 sources web search
 * does (title, sequentialId, description, category, location, tags,
 * custodian names, QR/barcode, custom fields) in a single query. ID-shaped
 * searches (which previously took a narrow indexed fast path with a
 * full-clause fallback) now resolve directly to the full, more-correct
 * result set — a superset of the old narrow match, matching the web indexes'
 * behaviour.
 */

/**
 * Resolves the mobile assets search to a Prisma where-fragment.
 *
 * Runs the shared org-scoped UNION (via `resolveAssetSearchIds`) for a
 * non-empty term set and materializes the matching asset ids into an
 * `id: { in }` fragment. The route's `baseWhere` has no top-level `OR` (status
 * AVAILABLE rides in `AND`, myCustody is `custody: { some }`), so this fragment
 * is safe to spread directly alongside it — it simply ANDs in.
 *
 * @param organizationId - Tenant scope; every UNION branch is org-scoped.
 * @param search - Raw (already length-capped) search term from the request.
 * @returns `{}` for a genuinely empty search (no filter); an always-false
 *   `{ id: { in: [] } }` for whitespace/bare-comma input (a debounced
 *   type-ahead space must not flash the full list) or a search with no
 *   matches; otherwise `{ id: { in: <matching ids> } }`.
 * @throws {ShelfError} 400 when the search matches more ids than the bind-param
 *   ceiling allows (see `resolveAssetSearchIds`) — only reachable by a mega-org.
 */
export async function resolveMobileAssetSearchWhere({
  organizationId,
  search,
}: {
  organizationId: string;
  search: string;
}): Promise<Prisma.AssetWhereInput> {
  const searchTerms = splitAssetSearchTerms(search);

  if (searchTerms.length === 0) {
    // Typed input that yields zero terms (whitespace / bare commas) must
    // match NOTHING, not everything: in a debounced type-ahead a single
    // typed space would otherwise flash the full unfiltered list.
    // `id: { in: [] }` is the canonical always-false Prisma clause. Only a
    // genuinely empty search string means "no filter".
    return search.length > 0 ? { id: { in: [] } } : {};
  }

  // Shared with the web getAssets fetcher: resolveAssetSearchIds runs the
  // org-scoped UNION (retry-wrapped, since a raw $queryRaw bypasses the
  // client's auto-retry extension) and guards the id set against Postgres'
  // ~65k bind-param ceiling, throwing a friendly 400 rather than hard-failing.
  const ids = await resolveAssetSearchIds({
    organizationId,
    terms: searchTerms,
  });

  return { id: { in: ids } };
}
