/**
 * Asset List Scope
 *
 * Which assets a member's asset list shows. A role whose
 * `assets.listScope` is "bookable" sees the assets available for bookings,
 * plus every asset they hold: in their custody, or checked out to them on an
 * active booking. An asset a member holds stays in their list even when it is
 * not available for bookings, which an asset can become while it is out.
 *
 * Every surface that reads the scope (web asset index in both modes, command
 * palette search, model rollups, the Companion asset list and Home tab) builds
 * its filter from this module, in Prisma or SQL form, so they always agree on
 * the set.
 *
 * @see {@link file://./../../../../../packages/permissions/src/policies.ts} `assets.listScope`
 */
import { BookingStatus, Prisma } from "@prisma/client";
import type { RoleAccess } from "~/utils/permissions/role-access";

/**
 * A list limited to assets available for bookings, plus the ones
 * `holderUserId` holds. `null` wherever a list is used means the list is not
 * limited.
 */
export type BookableListScope = {
  /** The member viewing the list: assets they hold always show. */
  holderUserId: string;
};

/** Booking statuses whose checked-out slices are still with the custodian. */
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
] as const;

/**
 * Resolves the caller's list scope from their role access.
 *
 * @param access - The caller's resolved role access
 * @param userId - The caller's user id
 * @returns The scope for a bookable-only role, `null` for a role that sees
 *   every asset
 */
export function resolveBookableListScope({
  access,
  userId,
}: {
  access: Pick<RoleAccess, "policy">;
  userId: string;
}): BookableListScope | null {
  return access.policy.assets.listScope === "bookable"
    ? { holderUserId: userId }
    : null;
}

/**
 * The scope as a Prisma fragment. It is a single `OR` group, so put it in an
 * `AND` array rather than spreading it into a `where` that may carry its own
 * `OR`.
 *
 * @param scope - The resolved scope
 * @returns The where fragment to AND into an asset query
 */
export function bookableListScopeWhere(
  scope: BookableListScope
): Prisma.AssetWhereInput {
  return {
    OR: [
      { availableToBook: true },
      { custody: { some: { custodian: { userId: scope.holderUserId } } } },
      // Out on an active booking the user is custodian of. Read from the slice
      // markers, never `Asset.status`: the status is global and says nothing
      // about whose booking the asset went out on.
      {
        bookingAssets: {
          some: {
            checkedOutAt: { not: null },
            checkedInAt: null,
            booking: {
              status: { in: [...ACTIVE_BOOKING_STATUSES] },
              OR: [
                { custodianUserId: scope.holderUserId },
                { custodianTeamMember: { userId: scope.holderUserId } },
              ],
            },
          },
        },
      },
    ],
  };
}

/**
 * The scope as a SQL condition over the asset alias `a`, for the raw-SQL
 * advanced index and model rollups. Must match {@link bookableListScopeWhere}
 * branch for branch. Covers kit-inherited custody too: those are `Custody`
 * rows like any other.
 *
 * @param scope - The resolved scope
 * @returns A parenthesised condition to AND into a WHERE clause
 */
export function bookableListScopeSql(scope: BookableListScope): Prisma.Sql {
  const userId = scope.holderUserId;
  return Prisma.sql`(a."availableToBook" = true OR EXISTS (
    SELECT 1 FROM "Custody" scope_cu
    JOIN "TeamMember" scope_tm ON scope_tm.id = scope_cu."teamMemberId"
    WHERE scope_cu."assetId" = a.id AND scope_tm."userId" = ${userId}
  ) OR EXISTS (
    SELECT 1 FROM "BookingAsset" scope_ba
    JOIN "Booking" scope_b ON scope_b.id = scope_ba."bookingId"
    LEFT JOIN "TeamMember" scope_btm ON scope_btm.id = scope_b."custodianTeamMemberId"
    WHERE scope_ba."assetId" = a.id
      AND scope_ba."checkedOutAt" IS NOT NULL
      AND scope_ba."checkedInAt" IS NULL
      AND scope_b.status IN ('ONGOING', 'OVERDUE')
      AND (scope_b."custodianUserId" = ${userId} OR scope_btm."userId" = ${userId})
  ))`;
}
