import type { AuditForEmail } from "~/emails/audit-updates-template";
import { auditUpdatesTemplateString } from "~/emails/audit-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

type BasicAuditEmailContentArgs = {
  auditName: string;
  assetsCount: number;
  creatorName: string;
  description?: string | null;
  dueDate?: Date | null;
  hints: ClientHint;
  auditId: string;
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
  hints,
  auditId,
  emailContent,
}: BasicAuditEmailContentArgs & { emailContent: string }) => {
  const dueDateText = dueDate
    ? `Due date: ${getDateTimeFormatFromHints(hints, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(dueDate)}\n`
    : "";

  return `Howdy,

${emailContent}

${auditName} | ${assetsCount} ${assetsCount === 1 ? "asset" : "assets"}

Created by: ${creatorName}
${dueDateText}${description ? `Description: ${description}\n` : ""}
To view the audit, follow the link below:
${SERVER_URL}/audits/${auditId}

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
 * Email content when an audit is cancelled
 */
export const auditCancelledEmailContent = (args: BasicAuditEmailContentArgs) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `The audit "${args.auditName}" has been cancelled by ${args.creatorName}. This audit is no longer active.`,
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
  const completedDateText = getDateTimeFormatFromHints(args.hints, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(args.completedAt);

  const dueDateText = args.dueDate
    ? getDateTimeFormatFromHints(args.hints, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(args.dueDate)
    : null;

  let statusMessage = `The audit "${args.auditName}" has been completed on ${completedDateText}.`;

  if (dueDateText) {
    if (args.wasOverdue) {
      statusMessage += `\n\nThis audit was completed after the due date (${dueDateText}). ⚠️`;
    } else {
      statusMessage += `\n\nThis audit was completed before the due date (${dueDateText}). ✅`;
    }
  }

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
  hints,
}: {
  audit: AuditForEmail;
  assigneeEmail: string;
  assigneeName: string;
  hints: ClientHint;
}) {
  const creatorName = `${audit.createdBy.firstName} ${audit.createdBy.lastName}`;
  const assetCount = audit._count.assets;

  try {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: `🔍 You've been assigned to audit: "${audit.name}"`,
      hints,
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
        hints,
        auditId: audit.id,
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
 * Sends cancellation emails to all assignees (excluding the creator)
 */
export function sendAuditCancelledEmails({
  audit,
  assigneesToNotify,
  hints,
}: {
  audit: AuditForEmail;
  assigneesToNotify: Array<{
    userId: string;
    user: { email: string; firstName: string | null; lastName: string | null };
  }>;
  hints: ClientHint;
}) {
  const creatorName = `${audit.createdBy.firstName} ${audit.createdBy.lastName}`;
  const assetCount = audit._count.assets;

  if (assigneesToNotify.length === 0) {
    return;
  }

  assigneesToNotify.forEach(async (assignment) => {
    try {
      const html = await auditUpdatesTemplateString({
        audit,
        heading: `❌ Audit cancelled: "${audit.name}"`,
        hints,
        assetCount,
      });

      sendEmail({
        to: assignment.user.email,
        subject: `❌ Audit cancelled: "${audit.name}" - shelf.nu`,
        text: auditCancelledEmailContent({
          auditName: audit.name,
          assetsCount: assetCount,
          creatorName,
          description: audit.description,
          dueDate: audit.dueDate,
          hints,
          auditId: audit.id,
        }),
        html,
      });

      const assigneeName = `${assignment.user.firstName || "Unknown"} ${
        assignment.user.lastName || "User"
      }`;
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
    user: {
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
  }>;
  hints: ClientHint;
  completedAt: Date;
  wasOverdue: boolean;
}): void {
  const creatorName = `${audit.createdBy.firstName || "Unknown"} ${
    audit.createdBy.lastName || "User"
  }`;
  const assetCount = audit._count.assets;

  if (assigneesToNotify.length === 0) {
    return;
  }

  assigneesToNotify.forEach(async (assignment) => {
    try {
      const html = await auditUpdatesTemplateString({
        audit,
        heading: `✅ Audit completed: "${audit.name}"`,
        hints,
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
          hints,
          auditId: audit.id,
          completedAt,
          wasOverdue,
        }),
        html,
      });

      const assigneeName = `${assignment.user.firstName || "Unknown"} ${
        assignment.user.lastName || "User"
      }`;
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
    };
  }>;
  hints: ClientHint;
  timeframe: string;
  heading: string;
}): void {
  const creatorName = `${audit.createdBy.firstName || "Unknown"} ${
    audit.createdBy.lastName || "User"
  }`;
  const assetCount = audit._count.assets;

  assignees.forEach(async (assignment) => {
    try {
      const html = await auditUpdatesTemplateString({
        audit,
        heading,
        hints,
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
          hints,
          auditId: audit.id,
          timeframe,
        }),
        html,
      });

      const assigneeName = `${assignment.user.firstName || "Unknown"} ${
        assignment.user.lastName || "User"
      }`;
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
 * Send overdue notice email to both creator and assignees
 */
export function sendAuditOverdueEmail({
  audit,
  recipients,
  hints,
}: {
  audit: AuditForEmail;
  recipients: Array<{
    email: string;
    firstName: string | null;
    lastName: string | null;
  }>;
  hints: ClientHint;
}): void {
  const creatorName = `${audit.createdBy.firstName || "Unknown"} ${
    audit.createdBy.lastName || "User"
  }`;
  const assetCount = audit._count.assets;

  recipients.forEach(async (recipient) => {
    try {
      const html = await auditUpdatesTemplateString({
        audit,
        heading: `⚠️ Audit overdue: "${audit.name}"`,
        hints,
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
          hints,
          auditId: audit.id,
        }),
        html,
      });

      const recipientName = `${recipient.firstName || "Unknown"} ${
        recipient.lastName || "User"
      }`;
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
