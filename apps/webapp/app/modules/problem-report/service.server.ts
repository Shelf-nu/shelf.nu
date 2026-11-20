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
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { wrapNameForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
import { resolveUserDisplayName, resolveUserGreetingName } from "~/utils/user";

const label = "Assets";

/** The most reports one member may send in {@link PROBLEM_REPORT_WINDOW_MS}. */
export const PROBLEM_REPORT_LIMIT = 10;
/** The window the report limit counts over: one hour. */
export const PROBLEM_REPORT_WINDOW_MS = 60 * 60 * 1000;

/** Text between the reporter link and the report in every report note. */
const PROBLEM_REPORT_PHRASE = " reported a problem: ";

/**
 * The history line for a report: the reporter as a link, then their text.
 *
 * The text goes inside a `name` tag, like every other value a person types
 * into a system note, so it always renders as literal text: Markdown in it
 * (a link, an image, emphasis) is never rendered. Runs of whitespace, line
 * breaks included, become one space so the line reads as one sentence in the
 * Activity tab, the CSV and the Companion. The email keeps the line breaks.
 *
 * @param reporter - The member who reported the problem
 * @param content - The report text, already validated by the schema
 * @returns The note content
 */
export function buildProblemReportNote(
  reporter: Parameters<typeof wrapUserLinkForNote>[0],
  content: string
) {
  return `${wrapUserLinkForNote(
    reporter
  )} reported a problem: ${wrapNameForNote(content.replace(/\s+/g, " "))}`;
}

/**
 * Records a problem report on an asset and emails the workspace's
 * problem-report audience.
 *
 * Refuses exactly when the asset page would refuse to open the asset (the
 * same `getAsset` lookup), and refuses an archived asset with the reason every
 * other action on an archived asset gives. The note is written before any
 * email is sent; a failed audience lookup or email is logged and never undoes
 * the note or fails the request.
 *
 * @param args.assetId - The asset the report is about, from the request
 * @param args.organizationId - The reporter's current workspace
 * @param args.userId - The reporter
 * @param args.content - The report text, already validated by
 *   `problemReportContentSchema`
 * @param args.userOrganizations - The reporter's workspaces (web only), so an
 *   asset in another of their workspaces answers like the asset page does
 * @param args.request - The request (web only), for that same answer
 * @returns The note and how many copies of the email went to the mailer
 * @throws {ShelfError} 404 when the reporter cannot open the asset, 400 when
 *   it is archived, 429 when the reporter is over the report limit, or when
 *   the note cannot be written
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
  const asset = await getAssetToReport({
    assetId,
    organizationId,
    userOrganizations,
    request,
  });

  // `getAsset` already read the archive state; the guard runs only to refuse
  // with the reason every other action on an archived asset gives.
  if (asset.archivedAt) {
    await assertAssetsAreNotArchived({
      assetIds: [asset.id],
      organizationId,
      actorUserId: userId,
    });
  }

  await assertUnderProblemReportLimit({ userId, organizationId });

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

  // From here on the report is saved: a failure only costs the email, never
  // the request, or a retry would write the report twice.
  let recipients: Awaited<
    ReturnType<typeof getOrganizationNotificationAudience>
  > = [];
  try {
    const audience = await getOrganizationNotificationAudience({
      organizationId,
      audience: "problemReports",
    });
    recipients = audience.filter((member) => member.id !== userId);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Could not load who receives a problem report",
        additionalData: { assetId: asset.id, organizationId },
        label,
      })
    );
  }

  const reporterName = resolveUserDisplayName(reporter) || reporter.email;

  // One render per recipient, each in its own try: one bad address or render
  // must not stop the others, and the report is already saved. Only the
  // copies handed to the mailer are counted.
  const handedToMailer = await Promise.all(
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
        return true;
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
        return false;
      }
    })
  );

  return { note, notifiedCount: handedToMailer.filter(Boolean).length };
}

/**
 * The asset page's own lookup, with a message that says what happened when
 * the asset belongs to another of the reporter's workspaces. The page answers
 * that case with a workspace switch prompt, which the report dialog cannot
 * show, so the generic "does not exist" text would mislead.
 *
 * @throws {ShelfError} 404 when the reporter cannot open the asset
 */
async function getAssetToReport({
  assetId,
  organizationId,
  userOrganizations,
  request,
}: {
  assetId: string;
  organizationId: string;
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  try {
    return await getAsset({
      id: assetId,
      organizationId,
      userOrganizations,
      request,
    });
  } catch (cause) {
    // `getAsset` names the other workspace in `additionalData.organization`
    // only for an asset the reporter can open after switching.
    if (isLikeShelfError(cause) && cause.additionalData?.organization) {
      throw new ShelfError({
        cause,
        title: "Asset not found",
        message:
          "This asset belongs to another workspace. Switch to that workspace to report a problem with it.",
        additionalData: { assetId, organizationId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }
    throw cause;
  }
}

/**
 * Refuses a report when the member has already sent
 * {@link PROBLEM_REPORT_LIMIT} in this workspace within the last
 * {@link PROBLEM_REPORT_WINDOW_MS}. Counted from their report notes, so the
 * limit holds across servers and covers the web form and the mobile route
 * alike.
 *
 * @throws {ShelfError} 429 when the member is over the limit
 */
async function assertUnderProblemReportLimit({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  const sent = await db.note.count({
    where: {
      userId,
      type: "UPDATE",
      createdAt: { gte: new Date(Date.now() - PROBLEM_REPORT_WINDOW_MS) },
      content: { contains: PROBLEM_REPORT_PHRASE },
      asset: { organizationId },
    },
  });

  if (sent >= PROBLEM_REPORT_LIMIT) {
    throw new ShelfError({
      cause: null,
      title: "Too many reports",
      message: `You have sent ${PROBLEM_REPORT_LIMIT} problem reports in the last hour. Try again later.`,
      additionalData: { userId, organizationId },
      label,
      status: 429,
      shouldBeCaptured: false,
    });
  }
}
