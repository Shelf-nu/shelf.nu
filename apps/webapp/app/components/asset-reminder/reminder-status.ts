/**
 * Reminder Status
 *
 * The status a reminder row shows on the reminders lists (/reminders and an
 * asset's Reminders tab). The reminder worker sends nothing for an archived
 * asset and clears the reminder's `activeSchedulerReference` when it skips
 * one, so a past-due reminder without a reference was never delivered. The
 * worker polls on an interval, so a reminder can be due while its job still
 * waits to run; the list loader reports that as `deliveryPending`.
 *
 * @see {@link file://./reminders-table.tsx}
 * @see {@link file://./../../modules/asset-reminder/worker.server.ts}
 */

/** What a reminder row says about its alert. */
export type ReminderStatus =
  | "Pending"
  | "Sending"
  | "Reminder sent"
  | "Paused"
  | "Not sent";

/**
 * Resolves a reminder's status from its alert time, its scheduler reference
 * and its asset's archive state.
 *
 * - Alert still ahead: "Pending", or "Paused" while the asset is archived (it
 *   fires if the asset is reinstated before then).
 * - Alert passed and its job has not run yet: "Sending", or "Paused" while
 *   the asset is archived (the worker will skip or advance it, not send it).
 * - Alert passed with a scheduler reference: "Reminder sent".
 * - Alert passed without one: "Not sent". The worker skipped it because the
 *   asset was archived at the alert time; reinstating the asset afterwards
 *   does not change that.
 *
 * @param args.alertDateTime - When the reminder is or was due
 * @param args.schedulerReference - The reminder's `activeSchedulerReference`
 * @param args.assetArchivedAt - The asset's `archivedAt`, null when active
 * @param args.deliveryPending - The reminder's job is still waiting, retrying
 *   or running (from the list loader)
 * @param args.now - The current time (injectable for tests)
 * @returns The status to show
 */
export function getReminderStatus({
  alertDateTime,
  schedulerReference,
  assetArchivedAt,
  deliveryPending = false,
  now = new Date(),
}: {
  alertDateTime: Date | string;
  schedulerReference: string | null;
  assetArchivedAt: Date | string | null;
  deliveryPending?: boolean;
  now?: Date;
}): ReminderStatus {
  const isDue = new Date(alertDateTime) <= now;

  if (!isDue) return assetArchivedAt ? "Paused" : "Pending";
  if (!schedulerReference) return "Not sent";
  if (deliveryPending) return assetArchivedAt ? "Paused" : "Sending";
  return "Reminder sent";
}
