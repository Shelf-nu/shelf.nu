/**
 * Reminder Status
 *
 * The status a reminder row shows on the reminders lists (/reminders and an
 * asset's Reminders tab). The reminder worker sends nothing for an archived
 * asset, so "Reminder sent" is only true when the alert time passed while the
 * asset was active.
 *
 * @see {@link file://./reminders-table.tsx}
 * @see {@link file://./../../modules/asset-reminder/worker.server.ts}
 */

/** What a reminder row says about its alert. */
export type ReminderStatus =
  | "Pending"
  | "Reminder sent"
  | "Paused"
  | "Not sent";

/**
 * Resolves a reminder's status from its alert time and its asset's archive
 * state.
 *
 * - Active asset: "Pending" before the alert time, "Reminder sent" after.
 * - Archived asset, alert still ahead: "Paused". It fires if the asset is
 *   reinstated before then.
 * - Archived asset, alert passed after it was archived: "Not sent".
 * - Archived asset, alert passed before it was archived: "Reminder sent".
 *
 * @param args.alertDateTime - When the reminder is or was due
 * @param args.assetArchivedAt - The asset's `archivedAt`, null when active
 * @param args.now - The current time (injectable for tests)
 * @returns The status to show
 */
export function getReminderStatus({
  alertDateTime,
  assetArchivedAt,
  now = new Date(),
}: {
  alertDateTime: Date | string;
  assetArchivedAt: Date | string | null;
  now?: Date;
}): ReminderStatus {
  const alertAt = new Date(alertDateTime);
  const isDue = alertAt <= now;

  if (!assetArchivedAt) return isDue ? "Reminder sent" : "Pending";
  if (!isDue) return "Paused";
  return new Date(assetArchivedAt) <= alertAt ? "Not sent" : "Reminder sent";
}
