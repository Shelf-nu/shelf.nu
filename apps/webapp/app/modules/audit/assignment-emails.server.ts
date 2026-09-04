import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";
import { AUDIT_INCLUDE_FOR_EMAIL } from "./constants";
import { sendAuditAssignedEmail } from "./email-helpers";

/**
 * Sends the "You've been assigned to audit" email to each recipient.
 *
 * Shared by the create route and the edit action so a person added later gets
 * the same email as one picked at creation. Loads the audit once and fans out
 * one send per recipient; callers pass only the users who are NEW to the audit
 * and never the actor themselves. Fire-and-forget safe: every failure is
 * logged here, nothing is thrown.
 */
export async function sendAuditAssignedEmails({
  auditId,
  organizationId,
  recipientUserIds,
  hints,
}: {
  auditId: string;
  organizationId: string;
  recipientUserIds: string[];
  hints: ClientHint;
}) {
  const recipients = Array.from(new Set(recipientUserIds));
  if (recipients.length === 0) {
    return;
  }

  try {
    // Scoped by organizationId for defense-in-depth even though callers pass
    // an audit they just created or edited in this org.
    const audit = await db.auditSession.findFirst({
      where: { id: auditId, organizationId },
      include: AUDIT_INCLUDE_FOR_EMAIL,
    });

    if (!audit) {
      return;
    }

    // Sequential on purpose: each send resolves the recipient's format
    // preferences and hands the mail to a single unpooled transport, so a
    // large team must not burst N lookups and N connections at once.
    for (const assignment of audit.assignments) {
      if (!recipients.includes(assignment.userId) || !assignment.user.email) {
        continue;
      }
      await sendAuditAssignedEmail({
        audit,
        assigneeEmail: assignment.user.email,
        assigneeName: resolveUserDisplayName(assignment.user) || "Unknown User",
        assigneeUserId: assignment.userId,
        hints,
      });
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to send audit assignment emails",
        additionalData: { auditId, organizationId, recipients },
        label: "Audit",
      })
    );
  }
}
