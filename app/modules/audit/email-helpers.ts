import type { AuditForEmail } from "~/emails/audit-updates-template";
import { auditUpdatesTemplateString } from "~/emails/audit-updates-template";
import { sendEmail } from "~/emails/mail.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

type BasicAuditEmailContentArgs = {
  auditName: string;
  assetsCount: number;
  creatorName: string;
  description?: string | null;
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
  auditId,
  emailContent,
}: BasicAuditEmailContentArgs & { emailContent: string }) => `Howdy,

${emailContent}

${auditName} | ${assetsCount} ${assetsCount === 1 ? "asset" : "assets"}

Created by: ${creatorName}
${description ? `Description: ${description}\n` : ""}
To view the audit, follow the link below:
${SERVER_URL}/audits/${auditId}

Thanks,
The Shelf Team
`;

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
export const auditCancelledEmailContent = (
  args: BasicAuditEmailContentArgs
) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `The audit "${args.auditName}" has been cancelled by ${args.creatorName}. This audit is no longer active.`,
  });

/**
 * Email content when an audit is completed
 */
export const auditCompletedEmailContent = (
  args: BasicAuditEmailContentArgs
) =>
  baseAuditTextEmailContent({
    ...args,
    emailContent: `The audit "${args.auditName}" has been completed.`,
  });

/**
 * Sends an email notification when a user is assigned to an audit
 */
export async function sendAuditAssignedEmail({
  audit,
  assigneeEmail,
  assigneeName,
}: {
  audit: AuditForEmail;
  assigneeEmail: string;
  assigneeName: string;
}) {
  const creatorName = `${audit.createdBy.firstName} ${audit.createdBy.lastName}`;
  const assetCount = audit._count.assets;

  try {
    const html = await auditUpdatesTemplateString({
      audit,
      heading: `🔍 You've been assigned to audit: "${audit.name}"`,
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
}: {
  audit: AuditForEmail;
  assigneesToNotify: Array<{ userId: string; user: { email: string; firstName: string | null; lastName: string | null } }>;
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
          auditId: audit.id,
        }),
        html,
      });

      const assigneeName = `${assignment.user.firstName || 'Unknown'} ${assignment.user.lastName || 'User'}`;
      Logger.info(`Audit cancellation email sent to ${assigneeName} (${assignment.user.email})`);
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
