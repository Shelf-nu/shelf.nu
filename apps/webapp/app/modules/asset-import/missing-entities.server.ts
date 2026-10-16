/**
 * "Will be created" lookup for an asset import.
 *
 * Names the categories, locations, tags, kits, custodians, custom fields and
 * asset models a file references that the workspace does not have yet, so the
 * preview names exactly what the job will create. Each kind mirrors the
 * matching of its `create*IfNotExists` helper: trimmed names, compared
 * case-insensitively, with soft-deleted team members and custom fields ignored.
 *
 * @see {@link file://./validate.server.ts}
 */
import type { Organization } from "@prisma/client";
import { db } from "~/database/db.server";
import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";
import type { ImportNewEntities } from "./types";

/**
 * Trims names, drops blanks and keeps the first spelling of each
 * case-insensitive duplicate.
 */
function distinctNames(values: Array<string | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const name = value?.trim();
    if (name && !seen.has(name.toLowerCase())) {
      seen.set(name.toLowerCase(), name);
    }
  }
  return Array.from(seen.values());
}

/**
 * Returns the names with no case-insensitive match among `existing`.
 */
function withoutMatches(names: string[], existing: Array<{ name: string }>) {
  const known = new Set(existing.map((e) => e.name.toLowerCase()));
  return names.filter((name) => !known.has(name.toLowerCase()));
}

/**
 * Finds the entities an import file references that do not exist yet.
 *
 * @param args.data - Parsed import rows
 * @param args.organizationId - Workspace the import targets
 * @returns Missing names per kind, each once, in first-seen spelling
 * @throws Database errors from the lookups
 */
export async function findMissingImportEntities({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}): Promise<ImportNewEntities> {
  const categories = distinctNames(data.map((row) => row.category));
  const locations = distinctNames(data.map((row) => row.location));
  const tags = distinctNames(data.flatMap((row) => row.tags ?? []));
  const kits = distinctNames(data.map((row) => row.kit));
  const custodians = distinctNames(data.map((row) => row.custodian));
  const assetModels = distinctNames(data.map((row) => row.assetModel));
  const customFields = distinctNames(
    Array.from(new Set(data.flatMap((row) => Object.keys(row))))
      .filter((header) => header.startsWith("cf:"))
      .map((header) => getDefinitionFromCsvHeader(header).name)
  );

  /** `in` + insensitive is an exact case-insensitive name match. */
  const nameIn = (names: string[]) => ({
    in: names,
    mode: "insensitive" as const,
  });
  const select = { name: true } as const;

  const [
    existingCategories,
    existingLocations,
    existingTags,
    existingKits,
    existingCustodians,
    existingCustomFields,
    existingAssetModels,
  ] = await Promise.all([
    categories.length
      ? db.category.findMany({
          where: { organizationId, name: nameIn(categories) },
          select,
        })
      : [],
    locations.length
      ? db.location.findMany({
          where: { organizationId, name: nameIn(locations) },
          select,
        })
      : [],
    tags.length
      ? db.tag.findMany({
          where: { organizationId, name: nameIn(tags) },
          select,
        })
      : [],
    kits.length
      ? db.kit.findMany({
          where: { organizationId, name: nameIn(kits) },
          select,
        })
      : [],
    custodians.length
      ? db.teamMember.findMany({
          where: { organizationId, deletedAt: null, name: nameIn(custodians) },
          select,
        })
      : [],
    customFields.length
      ? db.customField.findMany({
          where: {
            organizationId,
            deletedAt: null,
            name: nameIn(customFields),
          },
          select,
        })
      : [],
    assetModels.length
      ? db.assetModel.findMany({
          where: { organizationId, name: nameIn(assetModels) },
          select,
        })
      : [],
  ]);

  return {
    categories: withoutMatches(categories, existingCategories),
    locations: withoutMatches(locations, existingLocations),
    tags: withoutMatches(tags, existingTags),
    kits: withoutMatches(kits, existingKits),
    custodians: withoutMatches(custodians, existingCustodians),
    customFields: withoutMatches(customFields, existingCustomFields),
    assetModels: withoutMatches(assetModels, existingAssetModels),
  };
}
