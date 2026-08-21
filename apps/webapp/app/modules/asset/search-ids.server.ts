/**
 * Asset-search id resolver — the id-materializing half of asset search.
 *
 * Two of the three search surfaces resolve a search to a concrete list of
 * matching asset ids and feed it into a Prisma `id: { in: [...] }` clause:
 * the simple index (`getAssets`, `service.server.ts`) and the mobile assets
 * endpoint (`resolveMobileAssetSearchWhere`, `modules/api/mobile-asset-search.server.ts`).
 * Both used to inline the same `withPrismaRetry($queryRaw(buildAssetSearchUnion))`
 * → `rows.map((r) => r.id)` snippet; this module is the single shared
 * implementation, plus the bind-param ceiling guard both need.
 *
 * The **advanced index** (`generateWhereClause`, `query.server.ts`) deliberately
 * does NOT use this — it inlines the UNION as a raw `a."id" IN (<subquery>)`, so
 * it never materializes an id list and is not subject to the ceiling below.
 *
 * @see apps/webapp/app/modules/asset/search-union.server.ts (buildAssetSearchUnion)
 * @see apps/webapp/app/modules/asset/service.server.ts (getAssets)
 * @see apps/webapp/app/modules/api/mobile-asset-search.server.ts (resolveMobileAssetSearchWhere)
 */
import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  buildAssetSearchUnion,
  type AssetSearchIdRow,
} from "./search-union.server";
import { assertAssetSearchIdCeiling } from "./search.server";

/**
 * Resolves already-normalized search terms to the set of matching asset ids via
 * the shared org-scoped UNION ({@link buildAssetSearchUnion}) — index-driven,
 * org-scoped branches across all 10 search sources.
 *
 * Wrapped in `withPrismaRetry({ operationIsRead: true })` because a raw
 * `$queryRaw` bypasses the client's auto-retry extension, so a transient
 * pool/connection blip on this id-resolution query would otherwise surface as a
 * hard error (the SHELF-WEBAPP-227 class) instead of being retried. Guards the
 * materialized set against the bind-param ceiling before returning.
 *
 * @param params.organizationId - Tenant scope (bound as a literal in every branch).
 * @param params.terms - Non-empty list of trimmed, lowercased search terms.
 *   Callers must guard the empty case themselves (an empty search means "match
 *   nothing", expressed as `id: { in: [] }`, not "run the UNION").
 * @returns The matching asset ids (may be empty).
 * @throws {ShelfError} 400 when the match set exceeds the bind-param ceiling.
 */
export async function resolveAssetSearchIds({
  organizationId,
  terms,
}: {
  organizationId: string;
  terms: string[];
}): Promise<string[]> {
  const rows = await withPrismaRetry(
    () =>
      db.$queryRaw<AssetSearchIdRow[]>(
        Prisma.sql`SELECT "id" FROM ${buildAssetSearchUnion({
          organizationId,
          terms,
        })} AS "search_ids"`
      ),
    { operationIsRead: true }
  );

  assertAssetSearchIdCeiling(rows.length);

  return rows.map((row) => row.id);
}
