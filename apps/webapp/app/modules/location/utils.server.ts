/**
 * Location module server-side utilities.
 *
 * Houses Prisma `where`-clause builders for the Locations index so that bulk
 * "select all" operations resolve the SAME filtered set the user currently
 * sees on screen. Mirrors `getKitsWhereInput` (`~/modules/kit/utils.server`)
 * and `getAssetsWhereInput` (`~/modules/asset/utils.server`).
 *
 * @see {@link file://./service.server.ts} getLocations — the list loader whose filter this mirrors
 * @see {@link file://./../audit/context-helpers.server.ts} resolveAssetIdsForLocationSelection — consumer for bulk audit
 */

import type { Location, Prisma } from "@prisma/client";

/**
 * Builds the Prisma where-clause for the Locations index list from the current
 * URL search params. The Locations index only supports name search (the `s`
 * param), so this stays intentionally thin — keep it in lock-step with
 * {@link file://./service.server.ts} `getLocations` so a filtered "select all"
 * audits exactly the locations the user can see.
 *
 * @param params.organizationId - The caller's (validated) organization ID
 * @param params.currentSearchParams - Serialized list search params (e.g. `s=room`)
 * @returns A `Prisma.LocationWhereInput` scoped to the org and active search
 */
export function getLocationsWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Location["organizationId"];
  currentSearchParams?: string | null;
}): Prisma.LocationWhereInput {
  const where: Prisma.LocationWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);
  const search = searchParams.get("s")?.trim();

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  return where;
}
