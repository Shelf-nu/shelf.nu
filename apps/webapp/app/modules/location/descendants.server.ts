/**
 * Location hierarchy lookups.
 *
 * Walks the `parentId` tree with a recursive query. Every step is scoped to
 * one organization, so an id from another workspace never yields rows.
 *
 * @see {@link file://./child-locations-filter.server.ts}
 */
import type { Location, Organization } from "@prisma/client";
import { db } from "~/database/db.server";

type LocationDescendantIdRow = Pick<Location, "id" | "parentId">;

/**
 * Ids of a location and everything nested under it.
 *
 * @param args.organizationId - Scopes the walk; a location from another
 *   workspace returns nothing
 * @param args.locationId - The root of the walk
 * @param args.includeSelf - Whether the root's own id is in the result
 * @returns The root (unless excluded) plus every descendant id
 */
export async function getLocationDescendantIds({
  organizationId,
  locationId,
  includeSelf = true,
}: {
  organizationId: Organization["id"];
  locationId: Location["id"];
  includeSelf?: boolean;
}): Promise<string[]> {
  const rows = await db.$queryRaw<LocationDescendantIdRow[]>`
    WITH RECURSIVE location_descendants AS (
      SELECT
        id,
        "parentId",
        "organizationId"
      FROM "Location"
      WHERE id = ${locationId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT
        l.id,
        l."parentId",
        l."organizationId"
      FROM "Location" l
      INNER JOIN location_descendants ld ON ld.id = l."parentId"
      WHERE l."organizationId" = ${organizationId}
    )
    SELECT id, "parentId"
    FROM location_descendants
  `;

  return rows
    .filter((row) => includeSelf || row.id !== locationId)
    .map((row) => row.id);
}

/**
 * Ids of several locations plus everything nested under each, in ONE query.
 *
 * Use this when the roots come from request input: the root list is
 * de-duplicated first and the whole tree walk is a single statement, so the
 * number of ticked locations never multiplies database round-trips.
 *
 * @param args.organizationId - Scopes the walk; roots from another workspace
 *   return nothing
 * @param args.locationIds - The roots; duplicates are ignored
 * @returns Each root that exists in the workspace plus all its descendants,
 *   each id once
 */
export async function getDescendantIdsOfLocations({
  organizationId,
  locationIds,
}: {
  organizationId: Organization["id"];
  locationIds: Location["id"][];
}): Promise<string[]> {
  const rootIds = [...new Set(locationIds)];

  if (rootIds.length === 0) {
    return [];
  }

  // UNION (not UNION ALL) drops a node reached through two ticked roots, so
  // overlapping roots never walk the same subtree twice.
  const rows = await db.$queryRaw<Pick<Location, "id">[]>`
    WITH RECURSIVE location_descendants AS (
      SELECT id
      FROM "Location"
      WHERE id = ANY(${rootIds}::text[]) AND "organizationId" = ${organizationId}
      UNION
      SELECT l.id
      FROM "Location" l
      INNER JOIN location_descendants ld ON ld.id = l."parentId"
      WHERE l."organizationId" = ${organizationId}
    )
    SELECT id
    FROM location_descendants
  `;

  return rows.map((row) => row.id);
}
