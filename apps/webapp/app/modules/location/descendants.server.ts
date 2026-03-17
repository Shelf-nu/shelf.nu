import type { Location, Organization } from "@prisma/client";
import { sbDb } from "~/database/supabase.server";

export async function getLocationDescendantIds({
  organizationId,
  locationId,
  includeSelf = true,
}: {
  organizationId: Organization["id"];
  locationId: Location["id"];
  includeSelf?: boolean;
}): Promise<string[]> {
  const { data, error } = await sbDb.rpc("get_location_descendant_ids", {
    location_id: locationId,
    organization_id: organizationId,
  });

  if (error) throw error;

  const rows = (data ?? []) as { id: string; parentId: string | null }[];

  return rows
    .filter((row) => includeSelf || row.id !== locationId)
    .map((row) => row.id);
}
