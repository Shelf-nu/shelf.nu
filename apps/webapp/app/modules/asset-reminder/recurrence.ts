/**
 * Reminder recurrence — presets and next-occurrence math.
 *
 * A recurring reminder stores a cadence as (recurrenceUnit, recurrenceInterval)
 * plus the IANA timezone it was configured in. The worker advances
 * `alertDateTime` in place each time the reminder fires (see worker.server.ts),
 * so `alertDateTime` is always the NEXT occurrence of an active series.
 *
 * This module is pure (no db, no request context) so it is safe to import from
 * both server code (worker, reconciliation, actions) and UI components
 * (dialog preset list, table cadence labels).
 *
 * @see {@link file://./worker.server.ts}
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../components/asset-reminder/set-or-edit-reminder-dialog.tsx}
 */
import type { AssetReminder } from "@prisma/client";
import { ReminderRecurrenceUnit } from "@prisma/client";
import { DateTime, IANAZone } from "luxon";

/** Form values for the dialog's Repeat select. "never" = one-shot. */
export const REMINDER_REPEAT_VALUES = [
  "never",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannually",
  "yearly",
] as const;

export type ReminderRepeatValue = (typeof REMINDER_REPEAT_VALUES)[number];

/**
 * Maps every repeating preset to its stored (unit, interval) pair.
 * Storage is unit + interval (not the preset string) so future custom
 * cadences need no migration.
 */
export const REMINDER_REPEAT_PRESETS: Record<
  Exclude<ReminderRepeatValue, "never">,
  {
    label: string;
    unit: ReminderRecurrenceUnit;
    interval: number;
  }
> = {
  daily: { label: "Daily", unit: ReminderRecurrenceUnit.DAY, interval: 1 },
  weekly: { label: "Weekly", unit: ReminderRecurrenceUnit.WEEK, interval: 1 },
  biweekly: {
    label: "Every 2 weeks",
    unit: ReminderRecurrenceUnit.WEEK,
    interval: 2,
  },
  monthly: {
    label: "Monthly",
    unit: ReminderRecurrenceUnit.MONTH,
    interval: 1,
  },
  quarterly: {
    label: "Every 3 months",
    unit: ReminderRecurrenceUnit.MONTH,
    interval: 3,
  },
  semiannually: {
    label: "Every 6 months",
    unit: ReminderRecurrenceUnit.MONTH,
    interval: 6,
  },
  yearly: { label: "Yearly", unit: ReminderRecurrenceUnit.YEAR, interval: 1 },
};

/** The subset of AssetReminder fields recurrence logic operates on. */
export type ReminderRecurrenceFields = Pick<
  AssetReminder,
  | "recurrenceUnit"
  | "recurrenceInterval"
  | "recurrenceTimezone"
  | "recurrenceEndsAt"
>;

/** A reminder is recurring when it has a cadence configured. */
export function isRecurringReminder(
  reminder: Pick<AssetReminder, "recurrenceUnit" | "recurrenceInterval">
): boolean {
  return reminder.recurrenceUnit !== null && !!reminder.recurrenceInterval;
}

/**
 * Resolves the stored (unit, interval) pair back to the dialog preset value.
 * All v1 rows are written from presets; the fallback covers hypothetical
 * hand-written data so the edit dialog never crashes.
 */
export function repeatValueFromRecurrence(
  reminder: Pick<AssetReminder, "recurrenceUnit" | "recurrenceInterval">
): ReminderRepeatValue {
  if (!isRecurringReminder(reminder)) return "never";

  const match = Object.entries(REMINDER_REPEAT_PRESETS).find(
    ([, preset]) =>
      preset.unit === reminder.recurrenceUnit &&
      preset.interval === reminder.recurrenceInterval
  );

  return (match?.[0] as ReminderRepeatValue) ?? "monthly";
}

/** Luxon duration key for a recurrence unit. */
const UNIT_TO_LUXON: Record<
  ReminderRecurrenceUnit,
  "days" | "weeks" | "months" | "years"
> = {
  DAY: "days",
  WEEK: "weeks",
  MONTH: "months",
  YEAR: "years",
};

/** Human label for a cadence, e.g. "Monthly", "Every 2 weeks". */
export function describeRecurrence(
  reminder: Pick<AssetReminder, "recurrenceUnit" | "recurrenceInterval">
): string | null {
  if (!isRecurringReminder(reminder)) return null;

  const preset = Object.values(REMINDER_REPEAT_PRESETS).find(
    (p) =>
      p.unit === reminder.recurrenceUnit &&
      p.interval === reminder.recurrenceInterval
  );
  if (preset) return preset.label;

  // Fallback for non-preset (unit, interval) data.
  const interval = reminder.recurrenceInterval ?? 1;
  const unitWord = {
    DAY: "day",
    WEEK: "week",
    MONTH: "month",
    YEAR: "year",
  }[reminder.recurrenceUnit as ReminderRecurrenceUnit];
  return interval === 1
    ? `Every ${unitWord}`
    : `Every ${interval} ${unitWord}s`;
}

/**
 * Resolves a stored timezone to a zone luxon accepts. The stored value comes
 * from the client-hint cookie (validated at write time), but zone databases
 * drift over multi-year series lifetimes, so fall back to UTC instead of
 * propagating an Invalid DateTime into the scheduler.
 *
 * @param timezone - The stored IANA zone (or null for legacy/one-shot rows).
 * @returns A zone luxon accepts; UTC when the input is null or invalid.
 */
export function resolveRecurrenceZone(timezone: string | null): string {
  return timezone && IANAZone.isValidZone(timezone) ? timezone : "UTC";
}

/**
 * Formats an occurrence instant for user-facing text (emails, notes):
 * "15 Oct 2026, 09:00 (Europe/Berlin)". Rendered in the series' own timezone
 * with an explicit zone label so recipients in other zones aren't misled.
 *
 * @param date - The occurrence instant.
 * @param timezone - The series' stored timezone (falls back to UTC).
 * @returns The formatted date string including the zone label.
 */
export function formatOccurrenceInZone(
  date: Date,
  timezone: string | null
): string {
  const zone = resolveRecurrenceZone(timezone);
  const formatted = DateTime.fromJSDate(date)
    .setZone(zone)
    .toFormat("d LLL yyyy, HH:mm");
  return `${formatted} (${zone})`;
}

/**
 * Re-anchors an end-of-day instant from one timezone to another while keeping
 * the same CALENDAR date. Used when an existing recurring reminder is edited
 * from a different timezone: the submitted endsAt was parsed as end-of-day in
 * the editor's zone, but the series keeps its stored zone, so the end date
 * must be end-of-day in THAT zone or the instant silently shifts (and the
 * downgraded-tier change-detection would trip on plain edits).
 *
 * @param endsAt - The end-of-day instant parsed in `fromZone`.
 * @param fromZone - The zone the instant was parsed in (editor's zone).
 * @param toZone - The series' stored zone to re-anchor into.
 * @returns The end-of-day instant of the same calendar date in `toZone`.
 */
export function rebaseEndOfDayToZone(
  endsAt: Date,
  fromZone: string | null,
  toZone: string | null
): Date {
  const calendarDay = DateTime.fromJSDate(endsAt)
    .setZone(resolveRecurrenceZone(fromZone))
    .toFormat("yyyy-MM-dd");
  return DateTime.fromFormat(calendarDay, "yyyy-MM-dd", {
    zone: resolveRecurrenceZone(toZone),
  })
    .endOf("day")
    .toJSDate();
}

/**
 * Hard cap on catch-up iterations. Unreachable via the preset UI (a daily
 * series would need ~27 years of downtime); guards a future custom-cadence
 * UI or bad data from looping the worker/boot forever.
 */
const MAX_CATCH_UP_ITERATIONS = 10_000;

/**
 * Computes the next occurrence of a series strictly after `now`.
 *
 * - Wall-clock stable in the stored timezone (a 09:00 reminder stays 09:00
 *   across DST). Month-end clamps per luxon calendar math: a series anchored
 *   Jan 31 becomes Feb 28 and stays on the 28th thereafter — intended v1
 *   behavior (the advanced date is the new anchor).
 * - Catch-up policy: occurrences missed while the app was down are SKIPPED
 *   (the late-fired job still notifies once); we never send a burst.
 *
 * @param base - The occurrence the series last pointed at (usually the fired
 *               alertDateTime).
 * @param now - The reference instant; the result is strictly after it.
 * @returns The next occurrence, or null when the series has ended (next would
 *          exceed recurrenceEndsAt).
 */
export function getNextOccurrence({
  base,
  unit,
  interval,
  timezone,
  endsAt,
  now = new Date(),
}: {
  base: Date;
  unit: ReminderRecurrenceUnit;
  interval: number;
  timezone: string | null;
  endsAt?: Date | null;
  now?: Date;
}): Date | null {
  const zone = resolveRecurrenceZone(timezone);
  // Clamp defensively: interval < 1 would loop backwards/forever.
  const step = Math.max(1, Math.floor(interval));
  const luxonUnit = UNIT_TO_LUXON[unit];

  let next = DateTime.fromJSDate(base, { zone });
  if (!next.isValid) {
    // Invalid base (should be unreachable; alertDateTime is a real instant):
    // treat the series as ended rather than scheduling garbage.
    return null;
  }

  for (let i = 0; i < MAX_CATCH_UP_ITERATIONS; i++) {
    next = next.plus({ [luxonUnit]: step });
    if (next.toMillis() > now.getTime()) {
      if (endsAt && next.toMillis() > endsAt.getTime()) return null;
      return next.toJSDate();
    }
  }

  return null;
}
