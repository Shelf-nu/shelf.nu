import type { AuditForEmail } from "~/emails/audit-updates-template";
import { auditUpdatesTemplateString } from "~/emails/audit-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { ClientHint } from "~/utils/client-hints";
import {
  formatDate,
  resolveFormatPrefs,
  type RawFormatPrefs,
  type ResolvedFormatPrefs,
} from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";

type BasicAuditEmailContentArgs = {
  auditName: string;
  assetsCount: number;
  creatorName: string;
  description?: string | null;
  dueDate?: Date | null;
  /**
   * Fully-resolved formatting preferences of the RECIPIENT of this email —
   * used to render the due/completed dates in their locale/timezone.
   */
  prefs: ResolvedFormatPrefs;
  auditId: string;
  organizationId?: string;
  customEmailFooter?: string | null;
};

/**
 * Base content for audit-related emails (plain text version).
 * Provides general info in a standardized format.
 */
export const baseAuditTextEmailContent = ({
  auditName,
  creatorName,
  assetsCount,
  description,
  dueDate,
  prefs,
  auditId,
  organizationId,
  customEmailFooter,
  emailContent,
}: BasicAuditEmailContentArgs & { emailContent: string }) => {
  const dueDateText = dueDate
    ? `Due date: ${formatDate(dueDate, prefs, { includeTime: true })}\n`
    : "";
  const orgQuery = organizationId ? `?orgId=${organizationId}` : "";

  return `Howdy,

${emailContent}

${auditName} | ${assetsCount} ${assetsCount === 1 ? "asset" : "assets"}

Created by: ${creatorName}
${dueDateText}${description ? `Description: ${description}\n` : ""}
To view the audit, follow the link below:
${SERVER_URL}/audits/${auditId}/overview${orgQuery}
${customEmailFooter ? `\n---\n${customEmailFooter}\n` : ""}
Thanks,
The Shelf Team
`;
};

/**
 * Email content when an audit is assigned to a user
 */
export const auditAssignedEmailContent = (args: BasicAuditEmailContentArgs) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `You've been assigned to audit: "${args.auditName}".`,
  });

/**
 * Builds the plain-text body for the audit-cancelled email.
 *
 * `cancelledByName` is the user who actually performed the cancellation —
 * may differ from `creatorName` (the audit's original creator) when an
 * admin/owner cancels an audit a team member created.
 *
 * @param args - Standard audit email args plus the resolved canceller name.
 * @param args.cancelledByName - Display name of the acting canceller, used
 *   in the body sentence ("cancelled by {cancelledByName}").
 * @returns The full plain-text email body produced by
 *   {@link baseAuditTextEmailContent}.
 */
export const auditCancelledEmailContent = (
  args: BasicAuditEmailContentArgs & { cancelledByName: string }
) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `The audit "${args.auditName}" has been cancelled by ${args.cancelledByName}. This audit is no longer active.`,
  });

/**
 * Email content when an audit is completed
 */
export const auditCompletedEmailContent = (
  args: BasicAuditEmailContentArgs & {
    completedAt: Date;
    wasOverdue: boolean;
  }
) => {
  const orgQuery = args.organizationId ? `?orgId=${args.organizationId}` : "";
  const receiptQuery = orgQuery ? `${orgQuery}&receipt=1` : "?receipt=1";
  const completedDateText = formatDate(args.completedAt, args.prefs, {
    includeTime: true,
  });

  const dueDateText = args.dueDate
    ? formatDate(args.dueDate, args.prefs, { includeTime: true })
    : null;

  let statusMessage = `The audit "${args.auditName}" has been completed on ${completedDateText}.`;

  if (dueDateText) {
    if (args.wasOverdue) {
      statusMessage += `\n\nThis audit was completed after the due date (${dueDateText}). ⚠️`;
    } else {
      statusMessage += `\n\nThis audit was completed before the due date (${dueDateText}). ✅`;
    }
  }

  // Include a direct receipt link for the completion email.
  statusMessage += `\n\nDownload receipt:\n${SERVER_URL}/audits/${args.auditId}/overview${receiptQuery}`;

  return baseAuditTextEmailContent({
    ...args,
    emailContent: statusMessage,
  });
};

/**
 * Generic email content for audit reminders
 * @param timeframe - Human-readable timeframe (e.g., "24 hours", "4 hours", "1 hour")
 */
export const auditReminderEmailContent = (
  args: BasicAuditEmailContentArgs & { timeframe: string }
) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `Reminder: The audit "${args.auditName}" is due in ${args.timeframe}.`,
  });

/**
 * Email content for overdue audits
 */
export const auditOverdueEmailContent = (args: BasicAuditEmailContentArgs) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `The audit "${args.auditName}" is now overdue. Please complete it as soon as possible.`,
  });

/**
 * Sends an email notification when a user is assigned to an audit
 */
export async function sendAuditAssignedEmail({
  audit,
  assigneeEmail,
  assigneeName,
  assigneeUserId,
  hints,
}: {
  audit: AuditForEmail;
  assigneeEmail: string;
  assigneeName: string;
  /** The assignee (recipient) user id — used to resolve their format prefs. */
  assigneeUserId: string;
  hints: ClientHint;
}) {
  const creatorName = resolveUserDisplayName(audit.createdBy);
  const assetCount = audit._count.assets;
  // Recipient-specific prefs. Only a userId is available here (no assignee row
  // is passed to this singular sender), so a single fetch is acceptable — one
  // email, one lookup. hints is the null-field fallback.
  const prefs = await resolveUserFormatPrefsById(assigneeUserId, hints);

  try {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: `🔍 You've been assigned to audit: "${audit.name}"`,
      prefs,
      assetCount,
    });

    sendEmail({
      to: assigneeEmail,
      subject: `🔍 You've been assigned to audit: "${audit.name}" - shelf.nu`,
      text: auditAssignedEmailContent({
        auditName: audit.name,
        assetsCount: assetCount,
        creatorName,
        description: audit.description,
        dueDate: audit.dueDate,
        prefs,
        auditId: audit.id,
        customEmailFooter: audit.organization.customEmailFooter,
      }),
      html,
    });

    Logger.info(
      `Audit assignment email sent to ${assigneeName} (${assigneeEmail}) for audit: ${audit.name}`
    );
  } catch (emailError) {
    Logger.error(
      new ShelfError({
        cause: emailError,
        message: "Failed to send audit assignment email",
        additionalData: {
          auditId: audit.id,
          assigneeEmail,
          assigneeName,
        },
        label: "Audit",
      })
    );
  }
}

/**
 * Sends an "audit cancelled" email to each provided recipient.
 *
 * Recipient construction (assigneesToNotify) is the caller's responsibility —
 * the service decides who to notify. This function only handles delivery and
 * fan-out: per recipient it builds the plain-text + HTML versions, calls
 * {@link sendEmail}, and logs success or wraps any per-send failure in a
 * {@link ShelfError} via {@link Logger.error}. Failures for one recipient do
 * not stop sends to the others.
 *
 * @param args
 * @param args.audit - Audit record with the metadata embedded in the email
 *   (name, dueDate, organization, asset count, etc.).
 * @param args.assigneesToNotify - Recipients with email + display fields.
 *   Pass an empty array to skip sending entirely.
 * @param args.cancelledByName - Display name of the acting canceller. May
 *   differ from `audit.createdBy` when an admin/owner cancels someone
 *   else's audit; recipients see this name in the body, not the creator's.
 * @param args.hints - Client hints used as the null-field fallback when a
 *   recipient row is missing one of the four raw format-preference columns.
 * @returns void. Per-recipient send errors are logged, not thrown.
 */
export function sendAuditCancelledEmails({
  audit,
  assigneesToNotify,
  cancelledByName,
  hints,
}: {
  audit: AuditForEmail;
  assigneesToNotify: Array<{
    userId: string;
    // The four raw format-preference columns (via RawFormatPrefs) travel on
    // each recipient row so per-recipient prefs resolve from the loaded row —
    // no per-recipient DB fetch (avoids an N+1 in the bulk fan-out).
    user: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      displayName?: string | null;
    } & RawFormatPrefs;
  }>;
  /**
   * Display name of the user who actually cancelled the audit. May differ
   * from the original creator when an admin/owner cancels someone else's
   * audit — recipients see the real canceller, not the creator.
   */
  cancelledByName: string;
  hints: ClientHint;
}) {
  const creatorName = resolveUserDisplayName(audit.createdBy);
  const assetCount = audit._count.assets;

  if (assigneesToNotify.length === 0) {
    return;
  }

  assigneesToNotify.forEach(async (assignment) => {
    try {
      // Pure resolve from the already-loaded assignee row; hints is the
      // null-field fallback only. resolveFormatPrefs reads the four raw pref
      // fields off user.
      const prefs = resolveFormatPrefs(assignment.user, hints);

      const html = await auditUpdatesTemplateString({
        audit,
        heading: `❌ Audit cancelled: "${audit.name}"`,
        prefs,
        assetCount,
      });

      sendEmail({
        to: assignment.user.email,
        subject: `❌ Audit cancelled: "${audit.name}" - shelf.nu`,
        text: auditCancelledEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          cancelledByName,
          description: audit.description,
          dueDate: audit.dueDate,
          prefs,
          auditId: audit.id,
          customEmailFooter: audit.organization.customEmailFooter,
        }),
        html,
      });

      const assigneeName =
        resolveUserDisplayName(assignment.user) || "Unknown User";
      Logger.info(
        `Audit cancellation email sent to ${assigneeName} (${assignment.user.email})`
      );
    } catch (emailError) {
      Logger.error(
        new ShelfError({
          cause: emailError,
          message: "Failed to send audit cancellation email",
          additionalData: {
            auditId: audit.id,
            userId: assignment.userId,
            email: assignment.user.email,
          },
          label: "Audit",
        })
      );
    }
  });
}

/**
 * Send email notification to assignees when audit is completed
 */
export function sendAuditCompletedEmail({
  audit,
  assigneesToNotify,
  hints,
  completedAt,
  wasOverdue,
}: {
  audit: AuditForEmail;
  assigneesToNotify: Array<{
    userId: string;
    // Raw format-preference columns travel on each recipient row so prefs
    // resolve from the loaded row — no per-recipient DB fetch (no N+1).
    user: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      displayName?: string | null;
    } & RawFormatPrefs;
  }>;
  hints: ClientHint;
  completedAt: Date;
  wasOverdue: boolean;
}): void {
  const creatorName = resolveUserDisplayName(audit.createdBy) || "Unknown User";
  const assetCount = audit._count.assets;

  if (assigneesToNotify.length === 0) {
    return;
  }

  assigneesToNotify.forEach(async (assignment) => {
    try {
      // Pure resolve from the already-loaded assignee row; hints is the
      // null-field fallback only.
      const prefs = resolveFormatPrefs(assignment.user, hints);

      const html = await auditUpdatesTemplateString({
        audit,
        heading: `✅ Audit completed: "${audit.name}"`,
        prefs,
        assetCount,
        completedAt,
        wasOverdue,
      });

      sendEmail({
        to: assignment.user.email,
        subject: `✅ Audit completed: "${audit.name}" - shelf.nu`,
        text: auditCompletedEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          description: audit.description,
          dueDate: audit.dueDate,
          prefs,
          auditId: audit.id,
          organizationId: audit.organizationId,
          customEmailFooter: audit.organization.customEmailFooter,
          completedAt,
          wasOverdue,
        }),
        html,
      });

      const assigneeName =
        resolveUserDisplayName(assignment.user) || "Unknown User";
      Logger.info(
        `Audit completion email sent to ${assigneeName} (${assignment.user.email})`
      );
    } catch (emailError) {
      Logger.error(
        new ShelfError({
          cause: emailError,
          message: "Failed to send audit completion email",
          additionalData: {
            auditId: audit.id,
            userId: assignment.userId,
            email: assignment.user.email,
          },
          label: "Audit",
        })
      );
    }
  });
}

/**
 * Send audit reminder email to assignees
 * @param timeframe - Human-readable timeframe (e.g., "24 hours", "4 hours", "1 hour")
 * @param heading - Email heading/subject prefix (e.g., "🔔 Audit due in 24 hours")
 */
export function sendAuditReminderEmail({
  audit,
  assignees,
  hints,
  timeframe,
  heading,
}: {
  audit: AuditForEmail;
  assignees: Array<{
    userId: string;
    user: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      displayName?: string | null;
    };
  }>;
  hints: ClientHint;
  timeframe: string;
  heading: string;
}): void {
  const creatorName = resolveUserDisplayName(audit.createdBy) || "Unknown User";
  const assetCount = audit._count.assets;

  assignees.forEach(async (assignment) => {
    try {
      // Resolve THIS recipient's stored formatting prefs (their own
      // dateFormat/timeFormat/timeZone), not the scheduler-captured creator
      // hints — otherwise every reminder recipient sees the creator's
      // format/timezone. The scheduler's assignee rows (AUDIT_INCLUDE_FOR_EMAIL)
      // don't carry the raw preference columns, so a per-recipient lookup is
      // required; `hints` is the null-field fallback only. Audits have few
      // assignees, so the per-recipient fetch is cheap.
      const prefs = await resolveUserFormatPrefsById(assignment.userId, hints);

      const html = await auditUpdatesTemplateString({
        audit,
        heading,
        prefs,
        assetCount,
      });

      sendEmail({
        to: assignment.user.email,
        subject: `${heading}: "${audit.name}" - shelf.nu`,
        text: auditReminderEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          description: audit.description,
          dueDate: audit.dueDate,
          prefs,
          auditId: audit.id,
          customEmailFooter: audit.organization.customEmailFooter,
          timeframe,
        }),
        html,
      });

      const assigneeName =
        resolveUserDisplayName(assignment.user) || "Unknown User";
      Logger.info(
        `${timeframe} reminder email sent to ${assigneeName} (${assignment.user.email})`
      );
    } catch (emailError) {
      Logger.error(
        new ShelfError({
          cause: emailError,
          message: `Failed to send ${timeframe} reminder email`,
          additionalData: {
            auditId: audit.id,
            userId: assignment.userId,
            email: assignment.user.email,
          },
          label: "Audit",
        })
      );
    }
  });
}

/**
 * Send overdue notice email to both creator and assignees.
 *
 * Each recipient's dates are rendered in THEIR OWN stored formatting prefs
 * (dateFormat/timeFormat/timeZone). Pass the recipient's `userId` so their
 * prefs can be resolved per recipient; when it is absent the render falls back
 * to the scheduler-captured request `hints`.
 */
export function sendAuditOverdueEmail({
  audit,
  recipients,
  hints,
}: {
  audit: AuditForEmail;
  recipients: Array<{
    /**
     * Recipient user id — used to resolve their stored formatting prefs so the
     * dates render in the recipient's own format/timezone rather than the
     * creator's. Optional because some callers only have the email row; those
     * recipients fall back to the request `hints` for formatting.
     */
    userId?: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    displayName?: string | null;
  }>;
  hints: ClientHint;
}): void {
  const creatorName = resolveUserDisplayName(audit.createdBy) || "Unknown User";
  const assetCount = audit._count.assets;

  recipients.forEach(async (recipient) => {
    try {
      // Resolve THIS recipient's stored formatting prefs, not the
      // scheduler-captured creator hints. When the recipient's userId is
      // available we look up their own dateFormat/timeFormat/timeZone;
      // otherwise `hints` is the null-field fallback (previous behavior).
      const prefs = recipient.userId
        ? await resolveUserFormatPrefsById(recipient.userId, hints)
        : resolveFormatPrefs(null, hints);

      const html = await auditUpdatesTemplateString({
        audit,
        heading: `⚠️ Audit overdue: "${audit.name}"`,
        prefs,
        assetCount,
      });

      sendEmail({
        to: recipient.email,
        subject: `⚠️ Audit overdue: "${audit.name}" - shelf.nu`,
        text: auditOverdueEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          description: audit.description,
          dueDate: audit.dueDate,
          prefs,
          auditId: audit.id,
          customEmailFooter: audit.organization.customEmailFooter,
        }),
        html,
      });

      const recipientName = resolveUserDisplayName(recipient) || "Unknown User";
      Logger.info(
        `Overdue notice email sent to ${recipientName} (${recipient.email})`
      );
    } catch (emailError) {
      Logger.error(
        new ShelfError({
          cause: emailError,
          message: "Failed to send overdue notice email",
          additionalData: {
            auditId: audit.id,
            email: recipient.email,
          },
          label: "Audit",
        })
      );
    }
  });
}
