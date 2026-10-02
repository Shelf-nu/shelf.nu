/**
 * The critical-page query for the advanced asset index's streaming rebuild.
 *
 * Where the legacy mega-query (`buildAdvancedAssetsQuery`) hydrates every
 * relation for a page in one heavy per-row LATERAL, this query returns ONLY
 * the eagerly-available `CriticalRow` scalars — everything the page needs
 * before any hydration batch has resolved — plus the filtered total count.
 * Custody, bookings, tags, locations, the full kits/customFields lists, and
 * reminders are all deliberately absent from the projection below; those
 * stream in separately through `hydrate-simple.server.ts` /
 * `hydrate-heavy.server.ts`, keyed on the ids this query returns.
 *
 * Shares its paging with the legacy query by construction, not by
 * convention: both call `buildSlimPagedAssetCTEs` for the `asset_query` /
 * `sorted_asset_query` / `count_query` CTEs, so the flag-ON (this file) and
 * flag-OFF (`buildAdvancedAssetsQuery`) paths always select the identical
 * page of asset ids in the identical order — the two cannot silently
 * diverge on which rows a page contains, which the golden-CSV parity check
 * between them depends on.
 *
 * Raw SQL is invisible to the type-checker: `Asset.valuation` is the ONE
 * `@map`-remapped column in the whole schema (`@map("value")` — see
 * `packages/database/prisma/schema.prisma`), so the projection below selects
 * `a.value` and aliases it `'valuation'` in the JSON output. Every other
 * column referenced here was checked against the schema before writing this
 * file and carries no `@map`.
 *
 * @see {@link file://./types.ts} — `CriticalRow`, the shape this query fills
 * @see {@link file://../query.server.ts} — `buildSlimPagedAssetCTEs` (the
 *   shared slim phase this query and the legacy one both build on),
 *   `QR_ID_SUBQUERY`, and `buildAdvancedAssetsQuery` (the legacy mega-query
 *   this file's paging must stay identical to)
 * @see {@link file://./hydrate-heavy.server.ts} — the batches that hydrate
 *   everything this query does NOT select
 */
import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { db, type ExtendedPrismaClient } from "~/database/db.server";
import {
  buildSlimPagedAssetCTEs,
  QR_ID_SUBQUERY,
} from "~/modules/asset/query.server";
import type { CustomFieldSorting } from "~/modules/asset/types";
import { ShelfError } from "~/utils/error";
import type { CriticalRow } from "./types";

/** Inputs to {@link getAdvancedAssetCriticalPage}. */
export type GetAdvancedAssetCriticalPageArgs = {
  /** The caller's active organization. Not read directly by this query's SQL
   * (org scope is already baked into `whereClause` by `generateWhereClause`)
   * — carried here for parity with the hydration batches' `BatchArgs` and
   * attached to a thrown {@link ShelfError}'s context. */
  organizationId: string;
  /** WHERE clause from `generateWhereClause` (org scope + filters). */
  whereClause: Prisma.Sql;
  /** Inner `ORDER BY` body (no leading `ORDER BY `) from `parseSortingOptions`. */
  orderByInner: string;
  /** Validated custom-field sortings from `parseSortingOptions`. */
  customFieldSortings: CustomFieldSorting[];
  /** Raw `sortBy` specs, used to detect active qrId/custody/barcode sort keys. */
  sortBy: string[];
  /** Parsed filters, used to detect whether a custody filter is active. */
  parsedFilters: Filter[];
  /** `LIMIT/OFFSET` fragment, or `Prisma.empty` for takeAll (full export). */
  paginationClause: Prisma.Sql;
  /** The Prisma client to query through. Defaults to the app's `db`; real-DB
   * tests and the parity harness pass a fixture-scoped client so the raw SQL
   * actually runs against Postgres (a module-mocked `db` never would).
   * Production callers omit it. */
  client?: ExtendedPrismaClient;
};

/**
 * One row of {@link getAdvancedAssetCriticalPage}'s raw query. The query is a
 * single aggregate with no `GROUP BY` (mirroring `buildAdvancedAssetsQuery`'s
 * final SELECT), so it always returns exactly one row — `items` is `'[]'`,
 * never SQL NULL, when the page is empty.
 */
type CriticalPageQueryRow = { total_count: number; items: CriticalRow[] };

/**
 * Fetches one paginated, filtered page of the advanced asset index's
 * critical (eagerly-available) rows, plus the filtered total count — the
 * query the streaming loader awaits before it can render anything, with the
 * rest of each row's relations arriving later as resolved hydration batches.
 *
 * Builds on {@link buildSlimPagedAssetCTEs} for paging (see the file header
 * for why that sharing matters), then joins a LEAN, non-fanning projection
 * over the paged ids ONLY: `Asset` scalars, a correlated `qrId` subquery, 1:1
 * joins to `Category`/`AssetModel`, and a primary-kit LATERAL (oldest
 * `AssetKit` pivot row) — no custody/bookings/tags/locations/customFields/
 * reminders LATERALs. Those are comparatively expensive jsonb aggregations
 * this query intentionally excludes so the awaited critical page stays fast;
 * they stream in afterward via the hydration batches.
 *
 * @param args - See {@link GetAdvancedAssetCriticalPageArgs}.
 * @returns The page's filtered total count and its `CriticalRow[]`, in
 *   `__sortRank` order (the same page order `buildAdvancedAssetsQuery`
 *   produces for the same inputs). `items` is `[]`, never omitted, when the
 *   page has no matching rows.
 * @throws {ShelfError} If the query unexpectedly returns zero rows (it is an
 *   unconditional aggregate and should always return exactly one).
 */
export async function getAdvancedAssetCriticalPage({
  organizationId,
  whereClause,
  orderByInner,
  customFieldSortings,
  sortBy,
  parsedFilters,
  paginationClause,
  client = db,
}: GetAdvancedAssetCriticalPageArgs): Promise<{
  total_count: number;
  items: CriticalRow[];
}> {
  const slimCtes = buildSlimPagedAssetCTEs({
    whereClause,
    orderByInner,
    customFieldSortings,
    sortBy,
    parsedFilters,
    paginationClause,
  });

  // Pure read over the shared slim paging phase — safe to retry mid-flight,
  // same reasoning as the other advanced-index raw queries (see
  // fetchCustodyBatch in hydrate-heavy.server.ts).
  const rows = await withPrismaRetry(
    () =>
      client.$queryRaw<CriticalPageQueryRow[]>(
        Prisma.sql`${slimCtes}
      SELECT
        (SELECT total_count FROM count_query) AS total_count,
        COALESCE(json_agg(aq.critical_row ORDER BY saq."__sortRank"), '[]'::jsonb) AS items
      FROM sorted_asset_query saq
      LEFT JOIN LATERAL (
        -- LEAN critical-row projection, run once per page row (≤100).
        -- No custody/bookings/tags/locations/customFields/reminders here —
        -- those stream separately via the hydration batches.
        SELECT jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'description', a.description,
          'createdAt', to_char(a."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt', to_char(a."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'userId', a."userId",
          'mainImage', a."mainImage",
          'thumbnailImage', a."thumbnailImage",
          'mainImageExpiration', to_char(a."mainImageExpiration", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'categoryId', a."categoryId",
          'organizationId', a."organizationId",
          'status', a.status,
          'type', a.type,
          -- @map: the Prisma field Asset.valuation is stored in the DB column
          -- "value" (see the file header), so this selects a.value and aliases
          -- it 'valuation'. Using the Prisma field name as the column would 500.
          'valuation', a.value,
          'quantity', a.quantity,
          'unitOfMeasure', a."unitOfMeasure",
          'minQuantity', a."minQuantity",
          'consumptionType', a."consumptionType",
          'availableToBook', a."availableToBook",
          'sequentialId', a."sequentialId",
          'qrId', ${QR_ID_SUBQUERY},
          'assetModelId', a."assetModelId",
          'assetModelName', am.name,
          'assetModel', CASE
            WHEN a."assetModelId" IS NULL THEN NULL
            ELSE jsonb_build_object('image', am.image, 'thumbnailImage', am."thumbnailImage")
          END,
          'category', CASE
            WHEN c.id IS NULL THEN NULL
            ELSE jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color)
          END,
          'kit', CASE
            WHEN k.id IS NULL THEN NULL
            ELSE jsonb_build_object('id', k.id, 'name', k.name, 'status', k.status)
          END
        ) AS critical_row
        FROM public."Asset" a
        LEFT JOIN public."Category" c ON a."categoryId" = c.id
        LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id
        -- Primary kit = oldest AssetKit pivot row, mirroring the legacy
        -- mega-query's identical LATERAL in query.server.ts's assetQueryJoins.
        LEFT JOIN LATERAL (
          SELECT k2.id, k2.name, k2.status
          FROM public."AssetKit" ak
          JOIN public."Kit" k2 ON ak."kitId" = k2.id
          WHERE ak."assetId" = a.id
          ORDER BY ak."createdAt" ASC, ak.id ASC
          LIMIT 1
        ) k ON TRUE
        WHERE a.id = saq."assetId"
      ) aq ON TRUE;
    `
      ),
    { operationIsRead: true }
  );

  const page = rows[0];
  if (!page) {
    // The query is an unconditional aggregate (no GROUP BY, no WHERE on the
    // outer SELECT) — it always returns exactly one row, even for a page
    // with zero matching assets. Reaching here means something is
    // structurally wrong with the query itself, not with the data.
    throw new ShelfError({
      cause: null,
      message: "getAdvancedAssetCriticalPage returned no rows",
      label: "Assets",
      additionalData: { organizationId },
      shouldBeCaptured: true,
    });
  }

  return page;
}
