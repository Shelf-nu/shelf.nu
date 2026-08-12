/**
 * Shared asset-search UNION builder.
 *
 * Both asset indexes search the SAME 10 sources with OR-of-terms semantics:
 * the advanced index (raw SQL, `generateWhereClause`) and the simple index
 * (`getAssets`, Prisma). Historically each expressed this as a single
 * multi-table `OR`, which forced cross-org sequential scans (Category 156k
 * rows, Custody/TeamMember/User seq scans) — ~1.5s mean, 36s max on a 14k-asset
 * org. This module replaces that with an org-scoped `UNION` in which each
 * source is its own index-driven, org-scoped branch, producing the set of
 * matching asset ids. Measured ~165ms exact on the same org.
 *
 * The advanced index inlines this as `a.id IN (<union>)`; the simple index
 * executes it via `$queryRaw` and feeds the ids into its Prisma `where`.
 *
 * @see apps/webapp/app/modules/asset/query.server.ts (generateWhereClause)
 * @see apps/webapp/app/modules/asset/service.server.ts (getAssets)
 * @see superpowers/2026-08-12-assets-index-search-perf-design.md
 * @see .claude/rules/raw-sql-respects-prisma-map.md
 */
import { Prisma } from "@prisma/client";
import { ShelfError } from "~/utils/error";

/**
 * JSON paths inside `AssetCustomFieldValue.value` that hold user-visible text.
 * Moved here (from query.server.ts) so both the advanced query and this helper
 * can reference it without an import cycle.
 */
export const CUSTOM_FIELD_SEARCH_PATHS = [
  "valueText",
  "valueMultiLineText",
  "valueOption",
  "valueDate",
  "valueBoolean",
  "raw",
] as const;

/** Row shape when the UNION is executed standalone (simple index). */
export type AssetSearchIdRow = { id: string };

/**
 * Builds one term's OR-across-10-sources as a set of UNION-ed `SELECT id`
 * branches, each org-scoped with the LITERAL org id.
 */
function branchesForTerm(organizationId: string, term: string): Prisma.Sql {
  const like = `%${term}%`;
  const customFieldPredicate = Prisma.join(
    CUSTOM_FIELD_SEARCH_PATHS.map(
      (jsonPath) =>
        Prisma.sql`acfv."value"#>>${Prisma.raw(
          `'{${jsonPath}}'`
        )} ILIKE ${like}`
    ),
    " OR "
  );

  // Each branch selects the matching asset id, org-scoped via a literal param.
  return Prisma.sql`
    SELECT a."id" FROM public."Asset" a
      WHERE a."organizationId" = ${organizationId} AND a."title" ILIKE ${like}
    UNION
    SELECT a."id" FROM public."Asset" a
      WHERE a."organizationId" = ${organizationId} AND a."sequentialId" ILIKE ${like}
    UNION
    SELECT a."id" FROM public."Asset" a
      WHERE a."organizationId" = ${organizationId} AND a."description" ILIKE ${like}
    UNION
    SELECT a."id" FROM public."Category" c
      JOIN public."Asset" a ON a."categoryId" = c."id"
      WHERE c."organizationId" = ${organizationId}
        AND a."organizationId" = ${organizationId}
        AND c."name" ILIKE ${like}
    UNION
    SELECT al."assetId" FROM public."Location" l
      JOIN public."AssetLocation" al ON al."locationId" = l."id"
      WHERE l."organizationId" = ${organizationId} AND l."name" ILIKE ${like}
    UNION
    SELECT att."A" FROM public."Tag" t
      JOIN public."_AssetToTag" att ON att."B" = t."id"
      WHERE t."organizationId" = ${organizationId} AND t."name" ILIKE ${like}
    UNION
    SELECT cu."assetId" FROM public."TeamMember" tm
      LEFT JOIN public."User" u ON u."id" = tm."userId"
      JOIN public."Custody" cu ON cu."teamMemberId" = tm."id"
      WHERE tm."organizationId" = ${organizationId}
        AND (tm."name" ILIKE ${like} OR u."firstName" ILIKE ${like} OR u."lastName" ILIKE ${like})
    UNION
    SELECT q."assetId" FROM public."Qr" q
      JOIN public."Asset" a ON a."id" = q."assetId"
      WHERE a."organizationId" = ${organizationId} AND q."id" ILIKE ${like}
    UNION
    SELECT b."assetId" FROM public."Barcode" b
      JOIN public."Asset" a ON a."id" = b."assetId"
      WHERE a."organizationId" = ${organizationId} AND b."value" ILIKE ${like}
    UNION
    SELECT acfv."assetId" FROM public."AssetCustomFieldValue" acfv
      JOIN public."Asset" a ON a."id" = acfv."assetId"
      WHERE a."organizationId" = ${organizationId} AND (${customFieldPredicate})`;
}

/**
 * Builds the org-scoped UNION of asset ids matching ANY of `terms` in ANY of the
 * 10 search sources (OR-of-terms). Returns a parenthesised subquery producing a
 * single `id` column.
 *
 * @param organizationId - Tenant scope (bound as a LITERAL param in every branch).
 * @param terms - Non-empty list of already-trimmed, lowercased search terms.
 * @returns A `Prisma.Sql` subquery: `(SELECT id ... UNION ...)`.
 * @throws {ShelfError} If `terms` is empty (caller must guard).
 */
export function buildAssetSearchUnion({
  organizationId,
  terms,
}: {
  organizationId: string;
  terms: string[];
}): Prisma.Sql {
  if (terms.length === 0) {
    throw new ShelfError({
      cause: null,
      message: "buildAssetSearchUnion requires at least one search term",
      label: "Assets",
    });
  }

  // OR-of-terms: union every term's branch group into one flat UNION.
  const perTerm = terms.map((term) => branchesForTerm(organizationId, term));
  return Prisma.sql`(${Prisma.join(perTerm, "\n    UNION\n    ")})`;
}
