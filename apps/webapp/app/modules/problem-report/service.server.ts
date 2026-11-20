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

/** The refusal for a report in a Personal workspace, on web and phone alike. */
export const PERSONAL_WORKSPACE_REFUSAL =
  "Report a problem is for team workspaces. A Personal workspace has no one else to report to.";

/** Text between the reporter link and the report in every report note. */
export const PROBLEM_REPORT_PHRASE = " reported a problem: ";

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
  )}${PROBLEM_REPORT_PHRASE}${wrapNameForNote(content.replace(/\s+/g, " "))}`;
}

/**
 * Records a problem report on an asset and emails the workspace's
 * problem-report audience.
 *
 * Refuses exactly when the asset page would refuse to open the asset (the
 * same `getAsset` lookup), and refuses an archived asset with the reason every
 * other action on an archived asset gives, and refuses in a Personal
 * workspace. The note is written before any email is sent. The emails are
 * sent after this returns, so the member never waits for them; a failed
 * audience lookup or email is logged and never undoes the note or fails the
 * request.
 *
 * @param args.assetId - The asset the report is about, from the request
 * @param args.organizationId - The reporter's current workspace
 * @param args.userId - The reporter
 * @param args.content - The report text, already validated by
 *   `problemReportContentSchema`
 * @param args.userOrganizations - The reporter's workspaces (web only), so an
 *   asset in another of their workspaces answers like the asset page does
 * @param args.request - The request (web only), for that same answer
 * @returns The note, and whether anyone is emailed (the emails are sent after
 *   this returns)
 * @throws {ShelfError} 404 when the reporter cannot open the asset, 400 when
 *   it is archived or the workspace is a Personal one, 429 when the reporter is over the report limit, or when
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

  const [reporter, organization] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, ...USER_NAME_SELECT },
    }),
    db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, customEmailFooter: true, type: true },
    }),
  ]);

  // A Personal workspace has one person: a report would go to its own author.
  if (organization.type === "PERSONAL") {
    throw new ShelfError({
      cause: null,
      title: "Not available in a Personal workspace",
      message: PERSONAL_WORKSPACE_REFUSAL,
      additionalData: { organizationId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // Admission and the write are one step under the member's report lock. A
  // second report from them while it is held is refused at once rather than
  // waiting, so one member never holds more than one pooled connection here.
  const note = await db.$transaction(async (tx) => {
    await lockMemberProblemReports(tx, { userId, organizationId });
    await assertUnderProblemReportLimit({ userId, organizationId }, tx);
    // Read in the transaction that writes, so an asset archived while this
    // report waited is refused with the usual archived reason.
    await assertAssetsAreNotArchived(
      { assetIds: [asset.id], organizationId, actorUserId: userId },
      tx
    );
    return createNote(
      {
        content: buildProblemReportNote(reporter, content),
        type: "UPDATE",
        userId,
        assetId: asset.id,
        organizationId,
      },
      tx
    );
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

  // The member is answered without waiting for the emails: rendering them
  // takes longer the more people run the workspace, and the wait would let
  // a member who cannot see the team list estimate its size.
  void sendProblemReportEmails({
    recipients,
    reporter,
    organization,
    organizationId,
    asset,
    content,
  });

  return { note, emailed: recipients.length > 0 };
}

/**
 * Renders and hands one problem report email per recipient to the mailer.
 * Called without `await` once the report is saved, so it never throws: every
 * failure is logged, and one bad address or render does not stop the others.
 */
async function sendProblemReportEmails({
  recipients,
  reporter,
  organization,
  organizationId,
  asset,
  content,
}: {
  recipients: Awaited<ReturnType<typeof getOrganizationNotificationAudience>>;
  reporter: { email: string } & Parameters<typeof resolveUserDisplayName>[0];
  organization: { name: string; customEmailFooter: string | null };
  organizationId: string;
  asset: { id: string; title: string };
  content: string;
}) {
  try {
    const reporterName = resolveUserDisplayName(reporter) || reporter.email;

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
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Could not send the problem report emails",
        additionalData: { assetId: asset.id, organizationId },
        label,
      })
    );
  }
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
 * Takes a transaction-scoped lock on one member's problem reports in one
 * workspace, so their reports are admitted one at a time across servers. It
 * is released at commit or rollback. It never waits: while another report
 * from the same member holds it, this one is refused.
 *
 * @param tx - The active transaction
 * @param args.userId - The reporter
 * @param args.organizationId - The workspace the report is for
 * @throws {ShelfError} 429 when another report from the member holds the lock
 */
async function lockMemberProblemReports(
  tx: Pick<typeof db, "$queryRaw">,
  { userId, organizationId }: { userId: string; organizationId: string }
) {
  const [row] = await tx.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(hashtext('problem-report:' || ${organizationId} || ':' || ${userId})) AS locked`;

  if (!row?.locked) {
    throw new ShelfError({
      cause: null,
      title: "Too many reports",
      message:
        "Another report from you is still being sent. Try again in a moment.",
      additionalData: { userId, organizationId },
      label,
      status: 429,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Refuses a report when the member has already sent
 * {@link PROBLEM_REPORT_LIMIT} in this workspace within the last
 * {@link PROBLEM_REPORT_WINDOW_MS}. Counted from their report notes, so the
 * limit holds across servers and covers the web form and the mobile route
 * alike. Run it inside the transaction that writes the report, after
 * {@link lockMemberProblemReports}, or two reports can both pass.
 *
 * @throws {ShelfError} 429 when the member is over the limit
 */
async function assertUnderProblemReportLimit(
  { userId, organizationId }: { userId: string; organizationId: string },
  tx: Pick<typeof db, "note">
) {
  const sent = await tx.note.count({
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
