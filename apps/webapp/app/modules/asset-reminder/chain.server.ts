/**
 * Recurring-reminder chain: the advance step shared by the worker and boot
 * reconciliation.
 *
 * Design (no cron — pg-boss runs with noScheduling: true):
 * - A recurring reminder is ONE AssetReminder row whose alertDateTime is
 *   advanced in place to the next occurrence each time it fires
 *   (advance-before-notify, see worker.server.ts).
 * - Concurrency safety without locks: the row update is a compare-and-swap on
 *   the old alertDateTime (updateMany where { id, alertDateTime }); a racing
 *   actor (worker vs boot reconciliation vs a second bluegreen machine) loses
 *   the CAS and stops. Scheduling itself is deduped by a pg-boss singletonKey
 *   keyed on (reminderId, occurrence), so even a double-schedule of the same
 *   next occurrence collapses to one job.
 * - Chains can still die (handler crash after retries, jobs archived while
 *   workers are down for >14 days past fire time). reconcileRecurringReminders
 *   runs at every boot/deploy and re-arms provably-dead chains.
 *
 * @see {@link file://./worker.server.ts}
 * @see {@link file://./recurrence.ts}
 */
import type { AssetReminder } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { canUseRecurringReminders } from "~/utils/subscription.server";
import { getNextOccurrence, isRecurringReminder } from "./recurrence";
import {
  ASSETS_EVENT_TYPE_MAP,
  recurringReminderJobOptions,
  scheduleAssetReminder,
} from "./scheduler.server";
import { getUserTierLimit } from "../tier/service.server";

const label = "Asset Scheduler";

/**
 * Grace period before boot reconciliation considers a chain dead. Must be
 * comfortably larger than the pg-boss poll interval (5 min) plus the retry
 * backoff horizon, or reconciliation would hijack healthy in-flight fires and
 * the worker's stale-job guard would then swallow the due notification.
 */
export const RECONCILE_GRACE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Tolerance on the "did this occurrence actually come due" check. Covers
 * clock skew between the app server (evaluating the guard) and Postgres
 * (releasing the job).
 */
export const ADVANCE_CLOCK_EPSILON_MS = 60 * 1000; // 1 minute

type AdvanceResult = {
  /** The next occurrence now scheduled, when the advance happened. */
  next: Date | null;
  /** False when the series ended, the CAS lost, or the tier paused it. */
  advanced: boolean;
  /** True when the org's tier no longer includes recurrence (series pauses). */
  paused: boolean;
};

/**
 * Checks whether the reminder's organization (owner tier) still includes
 * recurring reminders. Fails OPEN on lookup errors so a transient DB issue
 * never kills a paying customer's series; an explicit `false` tier flag is
 * the only thing that pauses it.
 */
async function orgCanUseRecurringReminders(
  organizationId: AssetReminder["organizationId"]
): Promise<boolean> {
  try {
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { userId: true },
    });
    if (!organization) return true;

    const tierLimit = await getUserTierLimit(organization.userId);
    return canUseRecurringReminders(tierLimit);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Failed to resolve tier for recurring reminder advance. Failing open.",
        additionalData: { organizationId },
        label,
        shouldBeCaptured: false,
      })
    );
    return true;
  }
}

/**
 * Advances a recurring reminder to its next occurrence and schedules the
 * next pg-boss job.
 *
 * Ordering note: the CAS row-update commits BEFORE sendAfter. If scheduling
 * then fails, the row points at a next occurrence with no queued job. On the
 * pg-boss retry the worker sees the already-advanced (future) alertDateTime
 * and re-arms that occurrence via its orphan-recovery branch; boot
 * reconciliation is the terminal safety net if the retries are exhausted.
 * pg-boss writes through its own pool, so sendAfter can never be part of a
 * Prisma transaction.
 *
 * @throws When the CAS succeeded but scheduling failed — callers must treat
 *         this as critical (retry / reconcile), not swallow it.
 */
export async function advanceRecurringReminder({
  reminder,
  now = new Date(),
}: {
  reminder: Pick<
    AssetReminder,
    | "id"
    | "alertDateTime"
    | "organizationId"
    | "recurrenceUnit"
    | "recurrenceInterval"
    | "recurrenceTimezone"
    | "recurrenceEndsAt"
  >;
  now?: Date;
}): Promise<AdvanceResult> {
  if (!isRecurringReminder(reminder)) {
    return { next: null, advanced: false, paused: false };
  }

  const next = getNextOccurrence({
    base: reminder.alertDateTime,
    unit: reminder.recurrenceUnit!,
    interval: reminder.recurrenceInterval!,
    timezone: reminder.recurrenceTimezone,
    endsAt: reminder.recurrenceEndsAt,
    now,
  });

  /** Series ended (next occurrence would exceed recurrenceEndsAt). */
  if (!next) {
    return { next: null, advanced: false, paused: false };
  }

  if (!(await orgCanUseRecurringReminders(reminder.organizationId))) {
    return { next: null, advanced: false, paused: true };
  }

  /**
   * Compare-and-swap: only the actor that still sees the fired occurrence
   * gets to advance. A concurrent worker/reconcile/edit that already moved
   * alertDateTime makes this a no-op.
   */
  const { count } = await db.assetReminder.updateMany({
    where: {
      id: reminder.id,
      organizationId: reminder.organizationId,
      alertDateTime: reminder.alertDateTime,
    },
    data: { alertDateTime: next },
  });

  if (count === 0) {
    return { next: null, advanced: false, paused: false };
  }

  await scheduleAssetReminder({
    data: {
      reminderId: reminder.id,
      eventType: ASSETS_EVENT_TYPE_MAP.REMINDER,
    },
    when: next,
    options: recurringReminderJobOptions(reminder.id, next),
  });

  return { next, advanced: true, paused: false };
}

/**
 * Boot-time reconciliation: re-arms recurring series whose chain died
 * (worker crash after retries, jobs archived during long downtime, crash
 * between sendAfter and the reference write).
 *
 * Runs once per boot from entry.server.tsx — Shelf deploys frequently, so
 * this is the no-cron sweep. Only claims PROVABLY dead chains: the stored
 * occurrence must be more than RECONCILE_GRACE_MS in the past, far beyond
 * the poll + retry horizon of a healthy in-flight fire.
 *
 * Each row is fault-isolated: one bad row (e.g. a timezone the zone database
 * dropped) must never abort resurrection for the remaining tenants.
 */
export async function reconcileRecurringReminders({
  now = new Date(),
}: { now?: Date } = {}): Promise<{ scanned: number; rearmed: number }> {
  const deadBefore = new Date(now.getTime() - RECONCILE_GRACE_MS);

  const candidates = await db.assetReminder.findMany({
    where: {
      recurrenceUnit: { not: null },
      alertDateTime: { lt: deadBefore },
      OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: now } }],
    },
    select: {
      id: true,
      alertDateTime: true,
      organizationId: true,
      recurrenceUnit: true,
      recurrenceInterval: true,
      recurrenceTimezone: true,
      recurrenceEndsAt: true,
    },
  });

  let rearmed = 0;

  for (const reminder of candidates) {
    try {
      const { advanced } = await advanceRecurringReminder({ reminder, now });
      if (advanced) {
        rearmed += 1;
        Logger.info(
          `Re-armed dead recurring reminder chain ${reminder.id} (org ${reminder.organizationId}).`
        );
      }
      // advanced === false covers: series actually ended (next beyond
      // endsAt — quietly skipped every boot until endsAt passes), tier
      // paused, or a concurrent actor won the CAS. All are no-ops here.
    } catch (cause) {
      // why: per-row isolation — reconciliation is the only recovery
      // mechanism in a no-cron design, so one bad row must not abort the rest
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to reconcile recurring reminder. Continuing.",
          additionalData: { reminderId: reminder.id },
          label,
        })
      );
    }
  }

  return { scanned: candidates.length, rearmed };
}
