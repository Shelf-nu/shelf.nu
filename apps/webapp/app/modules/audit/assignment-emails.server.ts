/**
 * Audit assignment email fan-out.
 *
 * Tells the people who were just assigned to an audit, one email each. The
 * create route, the edit action and the duplicate route all call it with the
 * users who are new to the audit, so a person added later gets the same email
 * as one picked at creation.
 *
 * @see {@link file://./email-helpers.ts} sendAuditAssignedEmail
 * @see {@link file://./../../routes/api+/audits.start.ts}
 * @see {@link file://./../../routes/_layout+/audits.$auditId.tsx}
 * @see {@link file://./../../routes/_layout+/audits.$auditId.duplicate.tsx}
 */
import { db } from "~/database/db.server";
import type { ClientHint } from "~/utils/client-hints";
import { resolveFormatPrefs } from "~/utils/date-format";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";
import { AUDIT_INCLUDE_FOR_EMAIL } from "./constants";
import { sendAuditAssignedEmail, sendAuditAssignedPush } from "./email-helpers";

/**
 * Tells each recipient they were assigned to an audit: a push, then an email.
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

    const recipientAssignments = audit.assignments.filter((assignment) =>
      recipients.includes(assignment.userId)
    );

    // Every push first: each only queues a job, and none should wait behind
    // another person's email. The loaded rows carry the format preferences.
    for (const assignment of recipientAssignments) {
      sendAuditAssignedPush({
        audit,
        assigneeUserId: assignment.userId,
        prefs: resolveFormatPrefs(assignment.user, hints),
      });
    }

    // Emails one at a time on purpose: each send resolves the recipient's
    // format preferences and hands the mail to a single unpooled transport,
    // so a large team must not burst N lookups and N connections at once.
    for (const assignment of recipientAssignments) {
      if (!assignment.user.email) {
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
