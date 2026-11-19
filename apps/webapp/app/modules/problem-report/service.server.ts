/**
 * Problem Report Service
 *
 * "Report a problem" on an asset: a member says what is wrong, the report is
 * written to the asset's history as a system note (type UPDATE), and the people
 * who run the workspace get an email. The web action and the mobile route both
 * call {@link reportAssetProblem}, so they accept and refuse the same requests.
 *
 * Who receives the email is the `problemReports` audience of the role policy
 * table, read through `getOrganizationNotificationAudience`. The reporter is
 * never emailed about their own report.
 *
 * @see {@link file://./schema.ts} - the text rule
 * @see {@link file://../../emails/problem-report.tsx} - the email
 * @see {@link file://../../routes/_layout+/assets.$assetId.report-problem.tsx}
 * @see {@link file://../../routes/api+/mobile+/asset.report-problem.ts}
 */
import type { UserOrganization } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import {
  problemReportEmailHtml,
  problemReportEmailText,
  problemReportSubject,
} from "~/emails/problem-report";
import { getAsset } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { getOrganizationNotificationAudience } from "~/modules/organization/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import {
  appendUserTextToNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
import { resolveUserDisplayName, resolveUserGreetingName } from "~/utils/user";

const label = "Assets";

/**
 * The history line for a report: the reporter as a link, then their text.
 *
 * The text is put on one line (runs of whitespace, line breaks included,
 * become one space) because `appendUserTextToNote` quotes it in emphasis,
 * which Markdown ends at a line break. The email keeps the line breaks.
 *
 * @param reporter - The member who reported the problem
 * @param content - The report text, already validated by the schema
 * @returns The note content
 */
export function buildProblemReportNote(
  reporter: Parameters<typeof wrapUserLinkForNote>[0],
  content: string
) {
  return appendUserTextToNote(
    `${wrapUserLinkForNote(reporter)} reported a problem:`,
    content.replace(/\s+/g, " ")
  );
}

/**
 * Records a problem report on an asset and emails the workspace's
 * problem-report audience.
 *
 * Refuses exactly when the asset page would refuse to open the asset (the
 * same `getAsset` lookup), and refuses an archived asset with the reason every
 * other action on an archived asset gives. The note is written before any
 * email is sent; a failed email is logged and never undoes the note or fails
 * the request.
 *
 * @param args.assetId - The asset the report is about, from the request
 * @param args.organizationId - The reporter's current workspace
 * @param args.userId - The reporter
 * @param args.content - The report text, already validated by
 *   `problemReportContentSchema`
 * @param args.userOrganizations - The reporter's workspaces (web only), so an
 *   asset in another of their workspaces answers like the asset page does
 * @param args.request - The request (web only), for that same answer
 * @returns The note and how many people were emailed
 * @throws {ShelfError} 404 when the reporter cannot open the asset, 400 when
 *   it is archived, or when the note cannot be written
 */
export async function reportAssetProblem({
  assetId,
  organizationId,
  userId,
  content,
  userOrganizations,
  request,
}: {
  assetId: string;
  organizationId: string;
  userId: string;
  content: string;
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  const asset = await getAsset({
    id: assetId,
    organizationId,
    userOrganizations,
    request,
  });

  await assertAssetsAreNotArchived({
    assetIds: [asset.id],
    organizationId,
    actorUserId: userId,
  });

  const [reporter, organization] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, ...USER_NAME_SELECT },
    }),
    db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, customEmailFooter: true },
    }),
  ]);

  const note = await createNote({
    content: buildProblemReportNote(reporter, content),
    type: "UPDATE",
    userId,
    assetId: asset.id,
    organizationId,
  });

  const audience = await getOrganizationNotificationAudience({
    organizationId,
    audience: "problemReports",
  });
  const recipients = audience.filter((member) => member.id !== userId);

  const reporterName = resolveUserDisplayName(reporter) || reporter.email;

  // One render per recipient, each in its own try: one bad address or render
  // must not stop the others, and the report is already saved.
  await Promise.all(
    recipients.map(async (recipient) => {
      try {
        const props = {
          greetingName: resolveUserGreetingName(recipient) || null,
          recipientEmail: recipient.email,
          workspaceName: organization.name,
          assetId: asset.id,
          assetTitle: asset.title,
          reporterName,
          content,
          customEmailFooter: organization.customEmailFooter,
        };
        sendEmail({
          to: recipient.email,
          replyTo: reporter.email,
          subject: problemReportSubject(asset.title),
          text: problemReportEmailText(props),
          html: await problemReportEmailHtml(props),
        });
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Could not send a problem report email",
            additionalData: {
              assetId: asset.id,
              organizationId,
              recipientId: recipient.id,
            },
            label,
          })
        );
      }
    })
  );

  return { note, notifiedCount: recipients.length };
}
