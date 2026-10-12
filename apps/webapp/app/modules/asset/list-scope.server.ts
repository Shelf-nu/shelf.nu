/**
 * Asset List Scope
 *
 * Which assets a member's asset list shows. A role whose
 * `assets.listScope` is "bookable" sees the assets available for bookings,
 * plus every asset in their own custody: an asset assigned to someone stays in
 * their list even when it is not available for bookings.
 *
 * Every surface that reads the scope (web asset index in both modes, command
 * palette search, model rollups, the Companion asset list and Home tab) builds
 * its filter from this module, in Prisma or SQL form, so they always agree on
 * the set.
 *
 * @see {@link file://./../../../../../packages/permissions/src/policies.ts} `assets.listScope`
 */
import { Prisma } from "@prisma/client";
import type { RoleAccess } from "~/utils/permissions/role-access";

/**
 * A list limited to assets available for bookings, plus the ones
 * `holderUserId` has in custody. `null` wherever a list is used means the
 * list is not limited.
 */
export type BookableListScope = {
  /** The member viewing the list: assets in their custody always show. */
  holderUserId: string;
};

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
    ],
  };
}

/**
 * The scope as a SQL condition over the asset alias `a`, for the raw-SQL
 * advanced index and model rollups. Covers kit-inherited custody too: those
 * are `Custody` rows like any other.
 *
 * @param scope - The resolved scope
 * @returns A parenthesised condition to AND into a WHERE clause
 */
export function bookableListScopeSql(scope: BookableListScope): Prisma.Sql {
  return Prisma.sql`(a."availableToBook" = true OR EXISTS (
    SELECT 1 FROM "Custody" scope_cu
    JOIN "TeamMember" scope_tm ON scope_tm.id = scope_cu."teamMemberId"
    WHERE scope_cu."assetId" = a.id AND scope_tm."userId" = ${scope.holderUserId}
  ))`;
}
