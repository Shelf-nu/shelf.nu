/**
 * Membership Lock
 *
 * The one row lock every role-changing path takes on a workspace membership
 * before it decides anything, so concurrent role changes, removals and
 * ownership transfers on the same member are serialized.
 *
 * Lives in its own module because both the user service and the organization
 * service need it, and the user service already imports the organization
 * service: defining it in either would make an import cycle.
 *
 * @see {@link file://./service.server.ts} softDeleteUser, reconcileSsoGroupMembership, revokeMembershipInTx
 * @see {@link file://./utils.server.ts} the manual change-role action
 * @see {@link file://../organization/service.server.ts} transferOwnership
 */
import type { Organization, OrganizationRoles, User } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";

/**
 * Locks a membership row and returns its roles as persisted now.
 *
 * Every role-changing path calls this FIRST in its transaction, before any
 * entity write: the manual change-role action (`resolveUserAction`'s
 * `"changeRole"` case), the SSO group reconciler
 * (`reconcileSsoGroupMembership`), account deletion (`softDeleteUser`),
 * membership revocation (`revokeMembershipInTx`) and ownership transfer
 * (`transferOwnership`, which locks both memberships in `userId` order).
 * Concurrent changes on the same member then queue on this lock instead of
 * each holding a lock the other needs. Decide from the returned roles, never
 * from a snapshot read before the transaction.
 *
 * @param tx - The surrounding transaction
 * @param args.userId - The member
 * @param args.organizationId - The workspace
 * @returns The persisted roles, or `null` when the membership no longer exists
 */
export async function lockMembership(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  {
    userId,
    organizationId,
  }: { userId: User["id"]; organizationId: Organization["id"] }
): Promise<{ roles: OrganizationRoles[] } | null> {
  await tx.$queryRaw`
    SELECT id FROM "UserOrganization"
    WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;

  return tx.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { roles: true },
  });
}
