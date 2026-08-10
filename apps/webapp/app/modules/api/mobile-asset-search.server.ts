import type { Prisma } from "@prisma/client";

/**
 * Search fragment for the mobile assets list
 * (routes/api+/mobile+/assets.ts).
 *
 * Mirrors the LIGHT branches of the web asset search (`buildFullSearchOr`,
 * modules/asset/service.server.ts): title, sequentialId, description,
 * category name and tag names. Every branch rides an existing GIN trigram
 * index (compound Asset title+description, Category.name, Tag.name — see
 * migration 20260525110348_add_trigram_indexes_for_simple_search), so no new
 * index is needed.
 *
 * Deliberately still NOT the web search's heavy branches — custodian-name
 * traversal, custom-fields JSON ILIKE, location names and QR/barcode values.
 * The first two are slow (relation fan-out + unindexed JSON scan), and codes
 * are scanned rather than typed on mobile.
 *
 * @param search - Raw (already length-capped) search term from the request
 * @returns A spreadable `Prisma.AssetWhereInput` fragment — `{}` when the
 *   term is empty, otherwise an `OR` across the searchable fields
 */
export function buildMobileAssetSearchWhere(
  search: string
): Prisma.AssetWhereInput {
  if (!search) {
    return {};
  }

  const contains = { contains: search, mode: "insensitive" as const };

  return {
    OR: [
      { title: contains },
      // SAM id (e.g. "SAM-0001") — when the workspace display preference is
      // SAM every asset row shows it, so a typed id must match here.
      // `sequentialId` is indexed; a normal word term can't false-positive it.
      { sequentialId: contains },
      { description: contains },
      { category: { name: contains } },
      { tags: { some: { name: contains } } },
    ],
  };
}
