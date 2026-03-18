/* eslint-disable no-console */
import { AuditStatus } from "@prisma/client";
import type PgBoss from "pg-boss";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { AUDIT_SCHEDULER_EVENTS_ENUM } from "./constants";
import { sendAuditReminderEmail, sendAuditOverdueEmail } from "./email-helpers";
import { scheduleNextAuditJob } from "./service.server";
import type { AuditSchedulerData } from "./types";

/** Supabase select string for audit email data */
const AUDIT_EMAIL_SELECT =
  "*, createdBy:User!createdById(id, firstName, lastName, email), assignments:AuditAssignment(*, user:User!userId(id, firstName, lastName, email)), organization:Organization!organizationId(id, name, customEmailFooter, owner:User!ownerId(email))";

/**
 * Shared helper to fetch an audit for email sending.
 * Replaces the repeated db.auditSession.findFirstOrThrow pattern.
 */
async function fetchAuditForEmail(data: AuditSchedulerData) {
  const { data: audit, error } = await sbDb
    .from("AuditSession")
    .select(AUDIT_EMAIL_SELECT)
    .eq("id", data.id)
    .single();

  if (error || !audit) {
    throw new ShelfError({
      cause: error,
      message: "Audit not found",
      additionalData: { data, work: data.eventType },
      label: "Audit",
    });
  }

  // Get asset count separately
  const { count: assetCount } = await sbDb
    .from("AuditAsset")
    .select("*", { count: "exact", head: true })
    .eq("auditSessionId", data.id);

  // Coerce date strings to Date objects for compatibility
  return {
    ...audit,
    dueDate: audit.dueDate ? new Date(audit.dueDate) : null,
    _count: { assets: assetCount ?? 0 },
  };
}

/**
 * 24-hour reminder handler
 * Sends reminder email to assignees and schedules the next reminder (4h)
 */
const reminder24h = async ({ data }: PgBoss.Job<AuditSchedulerData>) => {
  const audit = await fetchAuditForEmail(data);

  // Only send if audit has due date and is not completed/cancelled
  if (
    audit.dueDate &&
    audit.status !== AuditStatus.COMPLETED &&
    audit.status !== AuditStatus.CANCELLED
  ) {
    sendAuditReminderEmail({
      audit: audit as any,
      assignees: audit.assignments as any,
      hints: data.hints,
      timeframe: "24 hours",
      heading: "\ud83d\udd14 Audit due in 24 hours",
    });

    // Schedule 4h reminder
    const when4h = new Date(audit.dueDate.getTime() - 4 * 60 * 60 * 1000);
    await scheduleNextAuditJob({
      data: {
        ...data,
        eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder4h,
      },
      when: when4h,
    });
  }
};

/**
 * 4-hour reminder handler
 * Sends reminder email to assignees and schedules the next reminder (1h)
 */
const reminder4h = async ({ data }: PgBoss.Job<AuditSchedulerData>) => {
  const audit = await fetchAuditForEmail(data);

  // Only send if audit has due date and is not completed/cancelled
  if (
    audit.dueDate &&
    audit.status !== AuditStatus.COMPLETED &&
    audit.status !== AuditStatus.CANCELLED
  ) {
    sendAuditReminderEmail({
      audit: audit as any,
      assignees: audit.assignments as any,
      hints: data.hints,
      timeframe: "4 hours",
      heading: "\ud83d\udd14 Audit due in 4 hours",
    });

    // Schedule 1h reminder
    const when1h = new Date(audit.dueDate.getTime() - 1 * 60 * 60 * 1000);
    await scheduleNextAuditJob({
      data: {
        ...data,
        eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder1h,
      },
      when: when1h,
    });
  }
};

/**
 * 1-hour reminder handler
 * Sends reminder email to assignees and schedules the overdue notice
 */
const reminder1h = async ({ data }: PgBoss.Job<AuditSchedulerData>) => {
  const audit = await fetchAuditForEmail(data);

  // Only send if audit has due date and is not completed/cancelled
  if (
    audit.dueDate &&
    audit.status !== AuditStatus.COMPLETED &&
    audit.status !== AuditStatus.CANCELLED
  ) {
    sendAuditReminderEmail({
      audit: audit as any,
      assignees: audit.assignments as any,
      hints: data.hints,
      timeframe: "1 hour",
      heading: "\ud83d\udd14 Audit due in 1 hour",
    });

    // Schedule overdue notice at due date time
    await scheduleNextAuditJob({
      data: {
        ...data,
        eventType: AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice,
      },
      when: audit.dueDate,
    });
  }
};

/**
 * Overdue notice handler
 * Sends overdue email to both creator and assignees
 * Does NOT change audit status (handled on frontend)
 */
const overdueNotice = async ({ data }: PgBoss.Job<AuditSchedulerData>) => {
  const audit = await fetchAuditForEmail(data);

  // Only send if audit is still not completed/cancelled
  if (
    audit.status !== AuditStatus.COMPLETED &&
    audit.status !== AuditStatus.CANCELLED
  ) {
    const createdBy = audit.createdBy as any;
    // Build recipients list: creator + all assignees
    const recipients = [
      {
        email: createdBy.email,
        firstName: createdBy.firstName,
        lastName: createdBy.lastName,
      },
      ...(audit.assignments as unknown as any[]).map((a: any) => ({
        email: a.user.email,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
      })),
    ];

    // Remove duplicates (in case creator is also an assignee)
    const uniqueRecipients = Array.from(
      new Map(recipients.map((r) => [r.email, r])).values()
    );

    sendAuditOverdueEmail({
      audit: audit as any,
      recipients: uniqueRecipients,
      hints: data.hints,
    });
  }
};

/**
 * Map of event types to handler functions
 */
const event2HandlerMap: Record<
  AUDIT_SCHEDULER_EVENTS_ENUM,
  (job: PgBoss.Job<AuditSchedulerData>) => Promise<void>
> = {
  [AUDIT_SCHEDULER_EVENTS_ENUM.reminder24h]: reminder24h,
  [AUDIT_SCHEDULER_EVENTS_ENUM.reminder4h]: reminder4h,
  [AUDIT_SCHEDULER_EVENTS_ENUM.reminder1h]: reminder1h,
  [AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice]: overdueNotice,
};

/**
 * Register audit worker to process scheduled jobs
 * This should be called once during server initialization
 */
export const registerAuditWorkers = async () => {
  await scheduler.work<AuditSchedulerData>(
    QueueNames.auditQueue,
    async (job) => {
      const handler = event2HandlerMap[job.data.eventType];
      if (typeof handler !== "function") {
        Logger.error(
          new ShelfError({
            cause: null,
            message: "Wrong event type received for the scheduled worker",
            additionalData: { job },
            label: "Audit",
          })
        );
        return;
      }
      try {
        await handler(job);
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Something went wrong while executing scheduled work.",
            additionalData: { data: job.data, work: job.data.eventType },
            label: "Audit",
          })
        );
      }
    }
  );
};
