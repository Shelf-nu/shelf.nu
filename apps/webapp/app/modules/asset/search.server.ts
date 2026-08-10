import type { Prisma } from "@prisma/client";
import { CUSTOM_FIELD_SEARCH_PATHS } from "./query.server";

/**
 * Single source of truth for the simple-mode asset search clauses.
 *
 * Consumed by BOTH:
 * - the web `getAssets` fetcher (assets index simple mode + every picker that
 *   goes through it) — see `service.server.ts`, and
 * - the mobile assets endpoint (`routes/api+/mobile+/assets.ts` via
 *   `modules/api/mobile-asset-search.server.ts`).
 *
 * Change a field here and BOTH surfaces change together — that is the point:
 * web and mobile search can no longer drift apart field-by-field. The
 * advanced-mode index searches via raw SQL instead (`query.server.ts`,
 * `generateWhereClause`) and is deliberately not covered by this module.
 */

/**
 * Splits a raw search string into normalized search terms.
 *
 * Mirrors the historical `getAssets` behavior exactly: lowercase, trim, split
 * on commas (comma = "match any of these"), trim each term, drop empties.
 *
 * @param search - Raw search string from the request
 * @returns Normalized terms; empty array when nothing searchable remains
 */
export function splitAssetSearchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * Matches the shape of an asset identifier or barcode / QR id. Two forms:
 *   - bare numeric ("21035", or a 12-digit UPC) — users commonly drop the
 *     prefix when scanning or typing an ID
 *   - canonical sequential ID ("SAM-0001") — letter prefix + dash + 4+
 *     digits, matching the format produced by getNextSequentialId
 *
 * Used to run ID-shaped queries against the narrow OR clause
 * ({@link buildNarrowAssetSearchOr}) first, instead of the full 10-branch
 * chain. The narrow clause skips the slow paths — custodian name traversal
 * and the unindexed customFields JSON ILIKE — while still covering every
 * place an ID-shaped value is *most likely* to live.
 *
 * Because a bare number can equally be a real barcode OR a value embedded in
 * a title / description / custom field (indistinguishable by shape), callers
 * fall back to the full search when the narrow clause returns zero rows — so
 * nothing is ever silently missed. See the fallback re-query in `getAssets`
 * and the mobile route's mirror of it.
 *
 * Loose terms like "lab-12" or "AS1000" don't match here and go straight to
 * the full search, since they're more likely substrings of titles, custom
 * fields, etc.
 *
 * @param term - A single normalized search term
 * @returns true when the term should take the narrow indexed fast path
 */
export function looksLikeAssetId(term: string): boolean {
  return /^\d+$/.test(term) || /^[a-z]+-\d{4,}$/i.test(term);
}

/**
 * Full multi-column search clause: matches a term anywhere it can
 * legitimately live — title, sequentialId, description, category, location,
 * tags, custodian names, QR/barcode, and custom fields.
 *
 * This is the slow path (custodian relation traversal + an unindexed
 * customFields JSON ILIKE), so for ID-shaped searches callers run
 * {@link buildNarrowAssetSearchOr} first and only use this when it finds
 * nothing.
 *
 * Returns one `{ OR: [...] }` entry per term; assigning the array to a
 * where's `OR` makes the terms match-any (comma semantics).
 *
 * @param searchTerms - Normalized terms from {@link splitAssetSearchTerms}
 * @returns One OR-group per term, ready to assign to `where.OR`
 */
export function buildFullAssetSearchOr(
  searchTerms: string[]
): Prisma.AssetWhereInput[] {
  return searchTerms.map((term) => ({
    OR: [
      // Search in asset fields
      { title: { contains: term, mode: "insensitive" } },
      // Search in asset sequential id
      { sequentialId: { contains: term, mode: "insensitive" } },
      // Search in asset description
      { description: { contains: term, mode: "insensitive" } },
      // Search in related category
      { category: { name: { contains: term, mode: "insensitive" } } },
      // Search in related location — traverses the AssetLocation pivot
      // since an asset can be placed at multiple locations.
      {
        assetLocations: {
          some: {
            location: {
              name: { contains: term, mode: "insensitive" },
            },
          },
        },
      },
      // Search in related tags
      {
        tags: {
          some: { name: { contains: term, mode: "insensitive" } },
        },
      },
      // Search in custodian names — custody is a list relation, so
      // traverse it with `some`.
      {
        custody: {
          some: {
            custodian: {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                {
                  user: {
                    OR: [
                      {
                        firstName: {
                          contains: term,
                          mode: "insensitive",
                        },
                      },
                      {
                        lastName: {
                          contains: term,
                          mode: "insensitive",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      // Search qr code id
      {
        qrCodes: {
          some: { id: { contains: term, mode: "insensitive" } },
        },
      },
      // Search barcode values
      {
        barcodes: {
          some: { value: { contains: term, mode: "insensitive" } },
        },
      },
      // Search in custom fields
      {
        customFields: {
          some: {
            OR: CUSTOM_FIELD_SEARCH_PATHS.map((jsonPath) => ({
              value: {
                path: [jsonPath],
                string_contains: term,
                mode: "insensitive",
              },
            })),
          },
        },
      },
    ],
  }));
}

/**
 * Narrow indexed fast path for ID-shaped searches: the columns where an
 * ID-shaped value can legitimately live — sequentialId, barcode value, QR id,
 * plus title and description. The ID columns are covered by trigram GIN
 * indexes added in migration 20260525110348, and title/description are
 * covered by the composite trigram GIN index Asset_title_description_idx —
 * so the planner stays on indexed scans and a real ID lookup (the common
 * case) returns immediately.
 *
 * title + description are included here (not deferred to the fallback)
 * because a bare-numeric term often lives ONLY inside a title — e.g.
 * searching "451" must match "KCI-451 Kids Resources Box". Without these
 * branches the narrow query can still return rows (some OTHER asset matches
 * "451" in an ID column), which suppresses the zero-row fallback and
 * silently drops the title-only match.
 *
 * Callers must still fall back to {@link buildFullAssetSearchOr} on zero
 * rows so the remaining slow-path columns (custodian names,
 * category/location/tags, custom-field JSON ILIKE) stay covered.
 *
 * @param searchTerms - Normalized terms from {@link splitAssetSearchTerms}
 * @returns A flat OR list covering every term, ready to assign to `where.OR`
 */
export function buildNarrowAssetSearchOr(
  searchTerms: string[]
): Prisma.AssetWhereInput[] {
  return searchTerms.flatMap((term) => [
    { sequentialId: { contains: term, mode: "insensitive" } },
    {
      barcodes: {
        some: { value: { contains: term, mode: "insensitive" } },
      },
    },
    {
      qrCodes: {
        some: { id: { contains: term, mode: "insensitive" } },
      },
    },
    // Trigram-indexed (Asset_title_description_idx) — matches a
    // bare-numeric substring embedded in a title/description directly
    // in the fast path, without relying on the zero-row fallback.
    { title: { contains: term, mode: "insensitive" } },
    { description: { contains: term, mode: "insensitive" } },
  ]);
}
