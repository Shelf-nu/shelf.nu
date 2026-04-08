/**
 * @file Entity resolution and asset fetching for bulk update via CSV import.
 * Handles batch database queries for categories, locations, tags, and
 * asset lookup by identifier. All functions here make database calls.
 *
 * @see {@link file://./import-update-types.ts} Types and constants
 * @see {@link file://./import-update.server.ts} Orchestration (server)
 */
import type { Asset, CustomField } from "@prisma/client";
import { db } from "~/database/db.server";
import { getRandomColor } from "~/utils/get-random-color";
import type {
  AssetChangePreview,
  AssetForUpdate,
  HeaderAnalysis,
} from "./import-update-types";

// ---------------------------------------------------------------------------
// Asset Fetching
// ---------------------------------------------------------------------------

/**
 * Fetches assets by the given identifier field (sequentialId or id).
 * Returns a map keyed by that identifier value for CSV row lookup.
 *
 * @param identifierValues - Array of identifier values to look up
 * @param organizationId - Organization scope for the query
 * @param dbField - Which database field to match against
 * @returns Map of identifier value → asset with relations
 */
export async function fetchAssetsForUpdate(
  identifierValues: string[],
  organizationId: string,
  dbField: "sequentialId" | "id"
): Promise<Map<string, AssetForUpdate>> {
  const assets = await db.asset.findMany({
    where: { [dbField]: { in: identifierValues }, organizationId },
    include: {
      category: { select: { name: true } },
      location: { select: { id: true, name: true } },
      tags: { select: { id: true, name: true } },
      customFields: { include: { customField: true } },
    },
  });

  // Key by the identifier field value so CSV rows can look up their asset
  return new Map(
    assets.map((a) => {
      const asset = a as Asset & {
        category: { name: string } | null;
        location: { id: string; name: string } | null;
        tags: { id: string; name: string }[];
        customFields: {
          id: string;
          value: unknown;
          customField: CustomField;
        }[];
      };
      const key = dbField === "id" ? asset.id : asset.sequentialId ?? "";
      return [key, asset];
    })
  );
}

// ---------------------------------------------------------------------------
// New Entity Detection (for preview warnings)
// ---------------------------------------------------------------------------

/**
 * Checks which categories, locations, and tags referenced in the changes
 * don't exist yet in the organization. These will be created on apply.
 *
 * @param assetsToUpdate - Assets with detected changes
 * @param headerAnalysis - Header classification from analyzeUpdateHeaders
 * @param organizationId - Organization scope
 * @returns Lists of entity names that will need to be created
 */
export async function detectNewEntities(
  assetsToUpdate: AssetChangePreview[],
  headerAnalysis: HeaderAnalysis,
  organizationId: string
): Promise<{ categories: string[]; locations: string[]; tags: string[] }> {
  const categoryNames = new Set<string>();
  const locationNames = new Set<string>();
  const tagNames = new Set<string>();

  for (const asset of assetsToUpdate) {
    for (const change of asset.changes) {
      const col = headerAnalysis.updatableColumns.find(
        (c) => c.csvHeader === change.field
      );
      if (!col) continue;

      if (col.internalKey === "category") {
        if (change.newValue.toLowerCase() !== "uncategorized") {
          categoryNames.add(change.newValue.trim());
        }
      } else if (col.internalKey === "location") {
        locationNames.add(change.newValue.trim());
      } else if (col.internalKey === "tags") {
        for (const tag of change.newValue.split(",")) {
          const t = tag.trim();
          if (t) tagNames.add(t);
        }
      }
    }
  }

  // Batch check categories (single query instead of N)
  const categoryNamesArr = Array.from(categoryNames);
  const existingCats =
    categoryNamesArr.length > 0
      ? await db.category.findMany({
          where: {
            organizationId,
            name: { in: categoryNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingCatNamesLc = new Set(
    existingCats.map((c) => c.name.toLowerCase())
  );
  const newCategories = categoryNamesArr.filter(
    (n) => !existingCatNamesLc.has(n.toLowerCase())
  );

  // Batch check locations
  const locationNamesArr = Array.from(locationNames);
  const existingLocs =
    locationNamesArr.length > 0
      ? await db.location.findMany({
          where: {
            organizationId,
            name: { in: locationNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingLocNamesLc = new Set(
    existingLocs.map((l) => l.name.toLowerCase())
  );
  const newLocations = locationNamesArr.filter(
    (n) => !existingLocNamesLc.has(n.toLowerCase())
  );

  // Batch check tags
  const tagNamesArr = Array.from(tagNames);
  const existingTags =
    tagNamesArr.length > 0
      ? await db.tag.findMany({
          where: {
            organizationId,
            name: { in: tagNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingTagNamesLc = new Set(
    existingTags.map((t) => t.name.toLowerCase())
  );
  const newTags = tagNamesArr.filter(
    (n) => !existingTagNamesLc.has(n.toLowerCase())
  );

  return {
    categories: newCategories,
    locations: newLocations,
    tags: newTags,
  };
}

// ---------------------------------------------------------------------------
// Entity Resolution Helpers
// ---------------------------------------------------------------------------

/**
 * Batch-resolves category names to IDs, creating missing ones.
 * Uses findMany + createMany + re-fetch to avoid race conditions.
 *
 * @param names - Category names from CSV changes
 * @param userId - User performing the import
 * @param organizationId - Organization scope
 * @returns Map of category name → category ID
 */
export async function batchResolveCategoryNames(
  names: string[],
  userId: string,
  organizationId: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const trimmedNames = names.map((n) => n.trim()).filter(Boolean);

  // Handle "uncategorized" specially
  for (const name of trimmedNames) {
    if (name.toLowerCase() === "uncategorized") {
      result.set(name, "uncategorized");
    }
  }

  const namesToResolve = trimmedNames.filter(
    (n) => n.toLowerCase() !== "uncategorized"
  );
  if (namesToResolve.length === 0) return result;

  // Deduplicate case-insensitively — keep first spelling per lowercase key
  const lcToOriginal = new Map<string, string>();
  for (const name of namesToResolve) {
    const lc = name.toLowerCase();
    if (!lcToOriginal.has(lc)) lcToOriginal.set(lc, name);
  }
  const uniqueNames = [...lcToOriginal.values()];

  // Batch fetch existing
  const existing = await db.category.findMany({
    where: {
      organizationId,
      name: { in: uniqueNames, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  const lcToId = new Map<string, string>();
  for (const cat of existing) {
    lcToId.set(cat.name.toLowerCase(), cat.id);
  }

  // Create missing (one per unique lowercase key)
  const missingNames = uniqueNames.filter((n) => !lcToId.has(n.toLowerCase()));
  if (missingNames.length > 0) {
    await db.category.createMany({
      data: missingNames.map((name) => ({
        name,
        color: getRandomColor(),
        userId,
        organizationId,
      })),
      skipDuplicates: true,
    });
    // Re-fetch to get IDs
    const created = await db.category.findMany({
      where: {
        organizationId,
        name: { in: missingNames, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    for (const cat of created) {
      lcToId.set(cat.name.toLowerCase(), cat.id);
    }
  }

  // Map all original name variants to their resolved ID
  for (const name of namesToResolve) {
    const id = lcToId.get(name.toLowerCase());
    if (id) result.set(name, id);
  }

  return result;
}

/**
 * Batch-resolves location names to IDs, creating missing ones.
 * Uses findMany + createMany + re-fetch to avoid race conditions.
 *
 * @param names - Location names from CSV changes
 * @param userId - User performing the import
 * @param organizationId - Organization scope
 * @returns Map of location name → location ID
 */
export async function batchResolveLocationNames(
  names: string[],
  userId: string,
  organizationId: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const trimmedNames = names.map((n) => n.trim()).filter(Boolean);
  if (trimmedNames.length === 0) return result;

  // Deduplicate case-insensitively — keep first spelling per lowercase key
  const lcToOriginal = new Map<string, string>();
  for (const name of trimmedNames) {
    const lc = name.toLowerCase();
    if (!lcToOriginal.has(lc)) lcToOriginal.set(lc, name);
  }
  const uniqueNames = [...lcToOriginal.values()];

  // Batch fetch existing
  const existing = await db.location.findMany({
    where: {
      organizationId,
      name: { in: uniqueNames, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  const lcToId = new Map<string, string>();
  for (const loc of existing) {
    lcToId.set(loc.name.toLowerCase(), loc.id);
  }

  // Create missing (one per unique lowercase key)
  const missingNames = uniqueNames.filter((n) => !lcToId.has(n.toLowerCase()));
  if (missingNames.length > 0) {
    await db.location.createMany({
      data: missingNames.map((name) => ({
        name,
        userId,
        organizationId,
      })),
      skipDuplicates: true,
    });
    // Re-fetch to get IDs
    const created = await db.location.findMany({
      where: {
        organizationId,
        name: { in: missingNames, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    for (const loc of created) {
      lcToId.set(loc.name.toLowerCase(), loc.id);
    }
  }

  // Map all original name variants to their resolved ID
  for (const name of trimmedNames) {
    const id = lcToId.get(name.toLowerCase());
    if (id) result.set(name, id);
  }

  return result;
}

/**
 * Resolves an array of tag names to their IDs, creating any that don't exist.
 * Uses batched queries to avoid N+1 round-trips.
 *
 * @param names - Tag names from CSV changes
 * @param userId - User performing the import
 * @param organizationId - Organization scope
 * @returns Array of `{ id }` objects preserving original order
 */
export async function resolveTagNamesToIds(
  names: string[],
  userId: string,
  organizationId: string
): Promise<{ id: string }[]> {
  const trimmedNames = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (trimmedNames.length === 0) return [];

  // Deduplicate (case-insensitive) while keeping first occurrence
  const seenLc = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of trimmedNames) {
    const lc = name.toLowerCase();
    if (!seenLc.has(lc)) {
      seenLc.add(lc);
      uniqueNames.push(name);
    }
  }

  // Batch fetch existing tags
  const existingTags = await db.tag.findMany({
    where: {
      organizationId,
      name: { in: uniqueNames, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  const nameToId = new Map<string, string>();
  for (const tag of existingTags) {
    nameToId.set(tag.name.toLowerCase(), tag.id);
  }

  // Create missing tags
  const toCreate = uniqueNames.filter((n) => !nameToId.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    await db.tag.createMany({
      data: toCreate.map((name) => ({
        name,
        userId,
        organizationId,
      })),
      skipDuplicates: true,
    });

    // Re-fetch to get IDs of newly created tags
    const newTags = await db.tag.findMany({
      where: {
        organizationId,
        name: { in: toCreate, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    for (const tag of newTags) {
      nameToId.set(tag.name.toLowerCase(), tag.id);
    }
  }

  // Build result preserving original order (including duplicates)
  const result: { id: string }[] = [];
  for (const name of trimmedNames) {
    const id = nameToId.get(name.toLowerCase());
    if (id) result.push({ id });
  }
  return result;
}
