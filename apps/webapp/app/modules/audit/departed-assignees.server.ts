/**
 * Departed Assignees
 *
 * Takes a member who is leaving a workspace off its open audits. Removing a
 * membership does not cascade to `AuditAssignment` (only deleting the user or
 * the audit does), so without this a removed person would stay listed as an
 * assignee, and would come back as one if invited again.
 *
 * Only PENDING and ACTIVE audits are touched. Completed, cancelled and
 * archived audits keep the person as the record of who was assigned.
 *
 * @see {@link file://./../user/service.server.ts} revokeMembershipInTx, the caller
 */
import { AuditStatus } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";

/** Audit statuses whose assignments are removed with the membership. */
export const OPEN_AUDIT_STATUSES = [AuditStatus.PENDING, AuditStatus.ACTIVE];

/**
 * Deletes a departing member's assignments on the workspace's open audits,
 * inside the caller's transaction. Records one `AUDIT_ASSIGNEE_REMOVED` event
 * and writes one note per audit it touches.
 *
 * @param tx - The transaction that removes the membership
 * @param args.userId - The member leaving the workspace
 * @param args.organizationId - The workspace
 * @param args.actorUserId - The person removing them, or null for system
 *   removals (SSO, SCIM, account deletion)
 * @returns The ids of the audits the member was taken off
 */
export async function removeDepartedMemberFromOpenAudits(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  {
    userId,
    organizationId,
    actorUserId,
  }: { userId: string; organizationId: string; actorUserId: string | null }
): Promise<string[]> {
  const assignments = await tx.auditAssignment.findMany({
    where: {
      userId,
      auditSession: { organizationId, status: { in: OPEN_AUDIT_STATUSES } },
    },
    select: { id: true, auditSessionId: true },
  });

  if (assignments.length === 0) {
    return [];
  }

  await tx.auditAssignment.deleteMany({
    where: { id: { in: assignments.map((assignment) => assignment.id) } },
  });

  const auditIds = Array.from(
    new Set(assignments.map((assignment) => assignment.auditSessionId))
  );

  await recordEvents(
    auditIds.map((auditSessionId) => ({
      organizationId,
      actorUserId,
      action: "AUDIT_ASSIGNEE_REMOVED" as const,
      entityType: "AUDIT" as const,
      entityId: auditSessionId,
      auditSessionId,
      targetUserId: userId,
    })),
    tx
  );

  // The user row stays when a membership is removed, so the name is still
  // there to read. A missing row still gets a note, under a neutral name.
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: USER_NAME_SELECT,
  });
  const name = wrapUserLinkForNote({ displayName: null, ...user, id: userId });

  await tx.auditNote.createMany({
    data: auditIds.map((auditSessionId) => ({
      auditSessionId,
      userId: actorUserId,
      type: "UPDATE" as const,
      content: `${name} is no longer an assignee: they were removed from the workspace.`,
    })),
  });

  return auditIds;
}
