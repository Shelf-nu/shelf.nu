/**
 * Start-audit orchestration shared by every "create an audit" entry point.
 *
 * Once the caller has resolved WHICH assets to audit, everything that follows
 * is the same for the bulk dialog (`/api/audits/start`) and the dedicated
 * creation page (`/audits/new`): the due date is parsed in the acting user's
 * timezone preference, the session is created, the assignee is emailed and
 * the reminder jobs are scheduled. Keeping that here means the two routes
 * cannot drift (one scheduling reminders the other forgets, say).
 *
 * @see {@link file://./../../routes/api+/audits.start.ts}
 * @see {@link file://./../../routes/_layout+/audits.new.tsx}
 */
import { DateTime } from "luxon";

import { db } from "~/database/db.server";
import { AUDIT_SCHEDULER_EVENTS_ENUM } from "~/modules/audit/constants";
import { sendAuditAssignedEmail } from "~/modules/audit/email-helpers";
import {
  createAuditSession,
  scheduleNextAuditJob,
} from "~/modules/audit/service.server";
import type { ClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { badRequest } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";

/** Milliseconds in one hour, for the reminder offsets below. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Arguments for {@link startAudit}.
 */
export type StartAuditArgs = {
  /** Audit name, already trimmed and non-empty. */
  name: string;
  /** Optional description; blank values are stored as `undefined`. */
  description?: string;
  /** Assets the audit expects. Must already be scoped to `organizationId`. */
  assetIds: string[];
  /** User id of the assignee, when one was chosen. */
  assignee?: string;
  /**
   * The due date exactly as the form submitted it (`DATE_TIME_FORMAT` wall
   * clock), or `undefined` when none was set. Read the RAW form value, never
   * a Zod-transformed one: the string is parsed here in the user's own zone.
   */
  dueDateString?: string;
  /** The acting user, who becomes the audit's creator. */
  userId: string;
  /** The workspace the audit belongs to. */
  organizationId: string;
  /** Client hints of the request, forwarded to the email and reminder jobs. */
  hints: ClientHint;
  /**
   * Resolves the acting user's timezone PREFERENCE (the zone date display
   * uses), called at most once and only when a due date was submitted. A
   * caller that already resolved it for another purpose passes a memoised
   * resolver so one request never looks it up twice.
   */
  resolveTimeZone: () => Promise<string>;
};

/**
 * Result of {@link startAudit}.
 */
export type StartAuditResult = {
  /** Id of the created audit session. */
  sessionId: string;
  /** Whether the audit was assigned to someone other than the creator. */
  isAssignedToOther: boolean;
};

/**
 * Creates an audit session for an already-resolved set of assets and runs the
 * follow-up work every entry point owes: assignee email and reminder jobs.
 *
 * The due date is parsed against the user's timezone preference, not the
 * browser hint, so the stored instant matches what the same user later sees
 * on screen (a browser in another zone would otherwise shift it).
 *
 * @param args - See {@link StartAuditArgs}
 * @returns The new session id and whether someone else was assigned
 * @throws {ShelfError} 400 when the due date is not in the future, or when
 *   `createAuditSession` refuses the assets (none, or not in this workspace)
 */
export async function startAudit({
  name,
  description,
  assetIds,
  assignee,
  dueDateString,
  userId,
  organizationId,
  hints,
  resolveTimeZone,
}: StartAuditArgs): Promise<StartAuditResult> {
  const sanitizedDescription = description?.trim() || undefined;

  // The timezone lookup is a DB read, so it only happens when there is a
  // date to parse.
  const dueDateUTC = dueDateString
    ? DateTime.fromFormat(dueDateString, DATE_TIME_FORMAT, {
        zone: await resolveTimeZone(),
      }).toJSDate()
    : undefined;
  if (dueDateUTC && dueDateUTC <= new Date()) {
    throw badRequest("Due date must be in the future.", {
      additionalData: {
        validationErrors: {
          dueDate: { message: "Due date must be in the future" },
        },
      },
    });
  }

  const { session } = await createAuditSession({
    name,
    description: sanitizedDescription,
    assetIds,
    organizationId,
    createdById: userId,
    assignee,
    dueDate: dueDateUTC,
  });

  const isAssignedToOther = Boolean(assignee && assignee !== userId);

  if (assignee && isAssignedToOther) {
    await notifyAssignee({
      sessionId: session.id,
      organizationId,
      assignee,
      hints,
    });
  }

  if (session.dueDate && session.dueDate > new Date()) {
    await scheduleReminders({
      sessionId: session.id,
      dueDate: session.dueDate,
      hints,
    });
  }

  return { sessionId: session.id, isAssignedToOther };
}

/**
 * Emails the assignee that an audit was handed to them. The email is sent
 * without awaiting so the response is not held up by the mail provider.
 */
async function notifyAssignee({
  sessionId,
  organizationId,
  assignee,
  hints,
}: {
  sessionId: string;
  organizationId: string;
  assignee: string;
  hints: ClientHint;
}) {
  // Scoped by organizationId for defense in depth even though the session was
  // just created for this workspace.
  const auditForEmail = await db.auditSession.findFirst({
    where: { id: sessionId, organizationId },
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
      organization: {
        include: {
          owner: {
            select: { email: true },
          },
        },
      },
      _count: {
        select: { assets: true },
      },
      assignments: {
        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!auditForEmail) return;

  const assigneeUser = auditForEmail.assignments.find(
    (a: { userId: string }) => a.userId === assignee
  );
  if (!assigneeUser?.user.email) return;

  const assigneeName =
    resolveUserDisplayName(assigneeUser.user) || "Unknown User";

  // `assignee` is the recipient user id, so the email helper can resolve
  // the assignee's own date/time format preferences.
  void sendAuditAssignedEmail({
    audit: auditForEmail,
    assigneeEmail: assigneeUser.user.email,
    assigneeName,
    assigneeUserId: assignee,
    hints,
  });
}

/**
 * Schedules the first reminder job for an audit with a future due date.
 *
 * Reminders go out 24h, 4h and 1h before the due date, then an overdue
 * notice at the due date; each job schedules the next. Only the first job
 * that is still in the future is queued here.
 */
async function scheduleReminders({
  sessionId,
  dueDate,
  hints,
}: {
  sessionId: string;
  dueDate: Date;
  hints: ClientHint;
}) {
  const now = new Date();
  const when24h = new Date(dueDate.getTime() - 24 * HOUR_MS);
  const when4h = new Date(dueDate.getTime() - 4 * HOUR_MS);
  const when1h = new Date(dueDate.getTime() - 1 * HOUR_MS);

  let eventType: AUDIT_SCHEDULER_EVENTS_ENUM;
  let when: Date;
  if (when24h > now) {
    eventType = AUDIT_SCHEDULER_EVENTS_ENUM.reminder24h;
    when = when24h;
  } else if (when4h > now) {
    eventType = AUDIT_SCHEDULER_EVENTS_ENUM.reminder4h;
    when = when4h;
  } else if (when1h > now) {
    eventType = AUDIT_SCHEDULER_EVENTS_ENUM.reminder1h;
    when = when1h;
  } else {
    eventType = AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice;
    when = dueDate;
  }

  await scheduleNextAuditJob({
    data: { id: sessionId, hints, eventType },
    when,
  });
}
