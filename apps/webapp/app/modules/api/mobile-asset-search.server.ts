import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  buildAssetSearchUnion,
  type AssetSearchIdRow,
} from "~/modules/asset/search-union.server";
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
 * Runs the shared org-scoped UNION for a non-empty term set and materializes
 * the matching asset ids into an `id: { in }` fragment. The route's
 * `baseWhere` has no top-level `OR` (status AVAILABLE rides in `AND`,
 * myCustody is `custody: { some }`), so this fragment is safe to spread
 * directly alongside it — it simply ANDs in.
 *
 * @param organizationId - Tenant scope; every UNION branch is org-scoped.
 * @param search - Raw (already length-capped) search term from the request.
 * @returns `{}` for a genuinely empty search (no filter); an always-false
 *   `{ id: { in: [] } }` for whitespace/bare-comma input (a debounced
 *   type-ahead space must not flash the full list) or a search with no
 *   matches; otherwise `{ id: { in: <matching ids> } }`.
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

  // Wrapped in withPrismaRetry (operationIsRead) like getAssets' and the
  // advanced index's identical raw query — a raw $queryRaw bypasses the
  // client's auto-retry extension, so a transient pool/connection blip on
  // the id-resolution query would otherwise surface as a hard error instead
  // of being retried.
  const rows = await withPrismaRetry(
    () =>
      db.$queryRaw<AssetSearchIdRow[]>(
        Prisma.sql`SELECT "id" FROM ${buildAssetSearchUnion({
          organizationId,
          terms: searchTerms,
        })} AS "search_ids"`
      ),
    { operationIsRead: true }
  );

  return { id: { in: rows.map((row) => row.id) } };
}
