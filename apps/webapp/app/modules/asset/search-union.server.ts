/**
 * Shared asset-search UNION builder.
 *
 * Both asset indexes search the SAME 10 sources with OR-of-terms semantics:
 * the advanced index (raw SQL, `generateWhereClause`) and the simple index
 * (`getAssets`, Prisma). Historically each expressed this as a single
 * multi-table `OR`, which forced cross-org sequential scans (Category 156k
 * rows, Custody/TeamMember/User seq scans) — ~1.5s mean, 36s max on a 14k-asset
 * org. This module replaces that with an org-scoped `UNION` of one branch per
 * source, producing the set of matching asset ids. Eight of the ten branches
 * are served by trigram (GIN) indexes — Asset title/description/sequentialId,
 * Category.name, Location.name, Tag.name, Qr.id, Barcode.value, TeamMember.name.
 * The remaining two — `User.firstName`/`lastName` and the custom-field
 * `value #>>` JSON paths — have no trigram index and instead rely on
 * org-scoping to bound their scan (the user-name branch is gated by
 * `tm.organizationId` before the ILIKE; the custom-field branch is
 * Asset-org-scoped). A GIN index on `AssetCustomFieldValue.value` is a tracked,
 * measure-later follow-up, not an oversight. Measured ~165ms on the 14k-asset
 * org that surfaced this — a measurement, not a guarantee for orgs with very
 * large custom-field data.
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
// CUSTOM_FIELD_SEARCH_PATHS is owned by ./search.server (the pure, db-free
// search module). Import it here so the UNION searches the SAME custom-field
// paths as the Prisma buildFullAssetSearchOr — one list, no drift — and
// re-export for this module's existing importers/tests.
import { CUSTOM_FIELD_SEARCH_PATHS } from "./search.server";

export { CUSTOM_FIELD_SEARCH_PATHS };

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
  // Defense-in-depth: the pivot-based branches (Location/Tag/Custody, like
  // Qr/Barcode/custom-field) JOIN back to Asset and pin a."organizationId" too,
  // so the helper never emits a cross-org asset id even if a pivot row somehow
  // crossed orgs — safe to use standalone, not only under a caller's outer org
  // filter (see .claude/rules/org-scope-user-supplied-ids.md).
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
      JOIN public."Asset" a ON a."id" = al."assetId"
      WHERE l."organizationId" = ${organizationId}
        AND a."organizationId" = ${organizationId}
        AND l."name" ILIKE ${like}
    UNION
    SELECT att."A" FROM public."Tag" t
      JOIN public."_AssetToTag" att ON att."B" = t."id"
      JOIN public."Asset" a ON a."id" = att."A"
      WHERE t."organizationId" = ${organizationId}
        AND a."organizationId" = ${organizationId}
        AND t."name" ILIKE ${like}
    UNION
    SELECT cu."assetId" FROM public."TeamMember" tm
      LEFT JOIN public."User" u ON u."id" = tm."userId"
      JOIN public."Custody" cu ON cu."teamMemberId" = tm."id"
      JOIN public."Asset" a ON a."id" = cu."assetId"
      WHERE tm."organizationId" = ${organizationId}
        AND a."organizationId" = ${organizationId}
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
