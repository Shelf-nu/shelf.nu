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
import { BookingStatus } from "@prisma/client";

/** The custodian dropdown's "Without custody" option submits this id. */
export const WITHOUT_CUSTODY = "without-custody";

/**
 * Builds the Prisma where-clause for a location's KIT list.
 *
 * Shared between {@link file://./service.server.ts} `getLocationKits`, which
 * renders the list, and `resolveLocationKitIds`, which expands a "select all"
 * over it. They must agree: the resolver drives a destructive removal, so any
 * disagreement either removes rows the user never saw or silently skips rows
 * they did.
 *
 * Deliberately NOT `getKitsWhereInput` (`~/modules/kit/utils.server`). That one
 * mirrors the *kits index*, whose custodian dropdown has no "Without custody"
 * option and which matches only directly-assigned custody. It is also shared by
 * `bulkDeleteKits`, so teaching it this page's wider semantics would widen a
 * destructive bulk delete beyond what the kits index displays.
 *
 * Note there is no `allowedTeamMemberIds` gate here, unlike the index builders.
 * `?teamMember=` is raw request input, and elsewhere a restricted viewer aiming
 * it at a colleague is an enumeration oracle — but every caller of this builder
 * sits behind a `location` permission, and BASE and SELF_SERVICE hold none
 * (`packages/permissions/src/matrix.ts` — `[PermissionEntity.location]: []` for
 * both). If a location surface is ever opened to those roles, this needs the
 * `CUSTODY_FILTER_REFUSED` treatment before that ships.
 *
 * @param params.organizationId - The caller's (validated) organization ID
 * @param params.locationId - The location whose kits are being listed
 * @param params.search - Free-text name search (the `s` param)
 * @param params.teamMemberIds - Selected custodians; may include
 *   {@link WITHOUT_CUSTODY}
 * @returns A `Prisma.KitWhereInput` scoped to the org and location
 */
export function getLocationKitsWhereInput({
  organizationId,
  locationId,
  search,
  teamMemberIds,
}: {
  organizationId: Location["organizationId"];
  locationId: Location["id"];
  search?: string | null;
  teamMemberIds?: string[] | null;
}): Prisma.KitWhereInput {
  const where: Prisma.KitWhereInput = { organizationId, locationId };

  if (teamMemberIds && teamMemberIds.length) {
    where.OR = [
      ...(where.OR ?? []),
      { custody: { custodianId: { in: teamMemberIds } } },
      { custody: { custodian: { userId: { in: teamMemberIds } } } },
      // A kit counts as held by someone if any of its assets is out on a
      // booking they hold — but only a booking that is actually running.
      {
        assetKits: {
          some: {
            asset: {
              bookingAssets: {
                some: {
                  booking: {
                    custodianTeamMemberId: { in: teamMemberIds },
                    status: {
                      in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        assetKits: {
          some: {
            asset: {
              bookingAssets: {
                some: {
                  booking: {
                    custodianUserId: { in: teamMemberIds },
                    status: {
                      in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...(teamMemberIds.includes(WITHOUT_CUSTODY) ? [{ custody: null }] : []),
    ];
  }

  if (search) {
    where.name = { contains: search, mode: "insensitive" };
  }

  return where;
}

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
