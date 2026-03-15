import type { Location, Organization } from "@shelf/database";
import { db } from "~/database/db.server";
import { rpc } from "~/database/transaction.server";

type LocationDescendantIdRow = Pick<Location, "id">;

export async function getLocationDescendantIds({
  organizationId,
  locationId,
  includeSelf = true,
}: {
  organizationId: Organization["id"];
  locationId: Location["id"];
  includeSelf?: boolean;
}): Promise<string[]> {
  const rows = (await rpc(db, "get_location_descendants", {
    p_parent_id: locationId,
  })) as Array<{ id: string; name: string; depth: number }>;

  const ids = rows.map((row) => row.id);

  if (includeSelf) {
    return [locationId, ...ids];
  }

  return ids;
}
