import type { AssetReminder } from "@prisma/client";
import { isBefore } from "date-fns";
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { isRecurringReminder } from "./recurrence";

export const ASSETS_EVENT_TYPE_MAP = {
  REMINDER: "REMINDER",
} as const;

export type AssetsEventType =
  (typeof ASSETS_EVENT_TYPE_MAP)[keyof typeof ASSETS_EVENT_TYPE_MAP];

export type AssetsSchedulerData = {
  reminderId: string;
  eventType: AssetsEventType;
};

/**
 * pg-boss send options for jobs belonging to a RECURRING reminder.
 *
 * - retryLimit/retryBackoff: the worker rethrows failures of the critical
 *   advance step (see worker.server.ts), so recurring jobs must be sent with
 *   retries or a transient error kills the chain until the next deploy's
 *   reconciliation. One-shot jobs keep the historical `{}` (swallowed errors,
 *   no retries) byte-identical.
 * - singletonKey: dedupes scheduling of the same occurrence when two actors
 *   race (worker advance vs boot reconciliation vs edit). pg-boss enforces a
 *   unique index on (name, singletonKey) for jobs in state < 'completed', so
 *   the losing sendAfter returns null instead of inserting a duplicate.
 */
export function recurringReminderJobOptions(
  reminderId: AssetReminder["id"],
  when: Date
): PgBoss.SendOptions {
  return {
    retryLimit: 3,
    retryBackoff: true,
    singletonKey: `asset-reminder-${reminderId}-${when.toISOString()}`,
  };
}

/**
 * Schedules the pg-boss job for a reminder occurrence and persists the job
 * reference on the row.
 *
 * When pg-boss dedupes the insert via singletonKey it returns null. We then
 * persist `activeSchedulerReference = null` EXPLICITLY (instead of skipping
 * the write like the audit scheduler does): the already-queued job with the
 * same key IS the correct next-occurrence job, and the worker's stale-job
 * guard treats a null reference as permissive. Keeping the OLD reference
 * around would make the guard kill that legitimate job.
 */
export async function scheduleAssetReminder({
  data,
  when,
  options = {},
}: {
  data: AssetsSchedulerData;
  when: Date;
  options?: PgBoss.SendOptions;
}) {
  try {
    const reference = await scheduler.sendAfter(
      QueueNames.assetsQueue,
      data,
      options,
      when
    );

    await db.assetReminder.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: internal scheduler-bookkeeping write (only sets activeSchedulerReference); all callers (createAssetReminder, editAssetReminder, worker advance, reconciliation) pass an org-proven or system-generated reminderId
      where: { id: data.reminderId },
      data: { activeSchedulerReference: reference ?? null },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while schedulng asset alert",
      label: "Asset Scheduler",
      additionalData: { ...data, when },
    });
  }
}

/**
 * This function is used to cancel an asset reminder scheduler.
 */
export async function cancelAssetReminderScheduler(
  reminder: Pick<
    AssetReminder,
    | "alertDateTime"
    | "activeSchedulerReference"
    | "recurrenceUnit"
    | "recurrenceInterval"
  >
) {
  try {
    /**
     * A one-shot reminder whose alertDateTime passed has already fired, so
     * there is nothing to cancel. Recurring reminders can hold a QUEUED job
     * while alertDateTime is briefly in the past (poll latency between fire
     * time and fetch), so for them we always attempt the cancel — pg-boss
     * cancel is a no-op on completed/missing jobs.
     */
    if (
      !isRecurringReminder(reminder) &&
      isBefore(reminder.alertDateTime, new Date())
    ) {
      return;
    }

    if (!reminder.activeSchedulerReference) {
      return;
    }

    await scheduler.cancel(reminder.activeSchedulerReference);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel asset reminder scheduler",
        additionalData: { ...reminder },
        label: "Asset Scheduler",
      })
    );
  }
}
