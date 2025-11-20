import type { Location, Organization } from "@prisma/client";
import { db } from "~/database/db.server";

type LocationDescendantIdRow = Pick<Location, "id" | "parentId">;

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
