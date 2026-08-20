import { differenceInHours } from "date-fns";
import { DateTime } from "luxon";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import type {
  DaySchedule,
  WeeklyScheduleJson,
  WorkingHoursData,
} from "./types";

/**
 * The day schedule that applies on a given zoned calendar date.
 *
 * A date-specific override wins over the weekly schedule, matching how
 * `validateWorkingHours` resolves the same data
 * (`~/components/booking/forms/forms-schema.ts`). Both the override key and the
 * weekday are read from `zoned`, so the caller's zone decides which day this is
 * — reading them from a device-local `Date` is what let a user whose preference
 * zone differs from their device get another day's hours.
 *
 * @param zoned - The instant, already converted to the zone that defines "day".
 * @param workingHours - The org's weekly schedule plus date overrides.
 * @returns The applicable schedule, or null when the day has none.
 */
function resolveDaySchedule(
  zoned: DateTime,
  workingHours: WorkingHoursData
): DaySchedule | null {
  const dateString = zoned.toFormat("yyyy-MM-dd");
  const override = workingHours.overrides.find(
    (o) => getOverrideDateKey(o.date) === dateString
  );

  if (override) {
    return {
      isOpen: override.isOpen,
      openTime: override.openTime || undefined,
      closeTime: override.closeTime || undefined,
    };
  }

  // Luxon weekday is 1=Mon..7=Sun; the schedule is keyed 0=Sun..6=Sat.
  const dayOfWeek = (zoned.weekday % 7).toString();
  return workingHours.weeklySchedule[dayOfWeek] || null;
}

/**
 * The same calendar day as `zoned`, at an `"HH:mm"` wall-clock time in its zone.
 *
 * Used to materialise the org's open/close times on a specific day. Doing this
 * with Luxon's `set` keeps the result in the target zone; the previous
 * `Date.setHours` equivalent placed it on the DEVICE clock instead.
 *
 * @param zoned - The day to place the time on, in the target zone.
 * @param time - Wall-clock time as `"HH:mm"`.
 * @returns A DateTime on the same calendar day at that wall-clock time.
 */
function atWallClock(zoned: DateTime, time: string): DateTime {
  const [hour, minute] = time.split(":").map(Number);
  return zoned.set({ hour, minute, second: 0, millisecond: 0 });
}

/**
 * Returns the YYYY-MM-DD key that identifies an override's calendar date.
 *
 * Working hours overrides represent an absolute calendar date with no time
 * component — the DB column is `@db.Date`, which Prisma hydrates as a Date at
 * UTC midnight. That Date is only a transport artifact: formatting it in the
 * runtime's local timezone shifts it one day back for users west of UTC, which
 * used to make an override for day D match bookings on day D-1. Reading the
 * date from UTC (or treating an already-YYYY-MM-DD string as-is) preserves the
 * absolute-date meaning.
 *
 * Contract: string inputs must be either date-only ("YYYY-MM-DD") or a UTC ISO
 * timestamp ("YYYY-MM-DD…Z"). Offset-style strings like
 * "2026-04-24T23:00:00-05:00" are not supported — producers in this codebase
 * (the API route and `normalizeWorkingHoursForValidation`) uphold this
 * invariant.
 */
export function getOverrideDateKey(date: string | Date): string {
  if (typeof date === "string") {
    // The first 10 characters are the absolute calendar date for both
    // date-only and UTC-ISO forms.
    return date.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Parses form data into WeeklyScheduleJson format
 * Handles the conversion from FormData entries to properly typed schedule object
 */
export function parseWeeklyScheduleFromFormData(
  formData: FormData
): WeeklyScheduleJson {
  const scheduleEntries = Array.from(formData.entries());
  const weeklyScheduleData: Record<string, Partial<DaySchedule>> = {};

  // Initialize all days to ensure complete data structure
  for (let i = 0; i <= 6; i++) {
    weeklyScheduleData[i.toString()] = {
      isOpen: false,
      openTime: undefined,
      closeTime: undefined,
    };
  }

  // Parse form entries
  scheduleEntries.forEach(([key, value]) => {
    if (key.includes(".")) {
      const [dayNumber, field] = key.split(".");
      if (dayNumber && field && weeklyScheduleData[dayNumber]) {
        if (field === "isOpen") {
          weeklyScheduleData[dayNumber][field] = value === "on";
        } else if (field === "openTime" || field === "closeTime") {
          // Only set time if it's not empty and the day is open
          const timeValue = value.toString().trim();
          if (timeValue && weeklyScheduleData[dayNumber].isOpen) {
            weeklyScheduleData[dayNumber][field] = timeValue;
          }
        }
      }
    }
  });

  return weeklyScheduleData as WeeklyScheduleJson;
}

/**
 * Transforms and validates working hours data from various sources (Prisma DB, API, etc.)
 * into a consistent format for validation schemas.
 *
 * @param rawWorkingHours - Working hours data from any source
 * @returns Properly typed WorkingHoursData or undefined if transformation fails
 */
export function normalizeWorkingHoursForValidation(
  rawWorkingHours: any
): WorkingHoursData | undefined {
  if (!rawWorkingHours) {
    return undefined;
  }

  // Always transform the data to ensure consistency
  try {
    const workingHours: WorkingHoursData = {
      enabled: Boolean(rawWorkingHours.enabled),
      weeklySchedule: rawWorkingHours.weeklySchedule as WeeklyScheduleJson,
      overrides: (rawWorkingHours.overrides || []).map((override: any) => ({
        id: String(override.id),
        // Overrides represent an absolute calendar date with no time component
        // (the DB column is `@db.Date`). Normalise to "YYYY-MM-DD" so downstream
        // comparisons never have to re-interpret a UTC-midnight Date in the
        // runtime's local timezone.
        date: getOverrideDateKey(override.date),
        isOpen: Boolean(override.isOpen),
        openTime: override.openTime || null,
        closeTime: override.closeTime || null,
        reason: override.reason || null,
      })),
    };

    // ✅ Validate the transformed result
    if (workingHours.weeklySchedule && Array.isArray(workingHours.overrides)) {
      return workingHours;
    }

    return undefined;
  } catch (_error) {
    return undefined;
  }
}
interface NextWorkingDayResult {
  startTime: Date;
  endTime: Date;
}

/**
 * Finds the next working day based on the current date and provided working hours.
 * It checks for date-specific overrides first, then falls back to the weekly schedule.
 * If no working day is found within 14 days, it defaults to tomorrow's 9 AM - 6 PM.
 * All calendar-day and wall-clock reasoning happens in `timeZone`, so "tomorrow"
 * and "9 AM" mean what the user means. Reading them off a device-local `Date`
 * put the search on the wrong day whenever the device and preference zones
 * straddled midnight.
 *
 * @param currentDate - The date from which to start searching for the next working day.
 * @param workingHours - The working hours data containing weekly schedules and overrides.
 * @param bufferStartTime - Buffer time in hours from current time.
 * @param timeZone - IANA zone that defines calendar days and wall-clock times.
 * @returns An object containing the start and end times of the next working day.
 */
function findNextWorkingDay(
  currentDate: Date,
  workingHours: WorkingHoursData,
  bufferStartTime: number,
  timeZone: string
): NextWorkingDayResult {
  const now = DateTime.fromJSDate(currentDate).setZone(timeZone);

  // Buffer expiry (current time + buffer hours), seconds stripped. Luxon values
  // are immutable, so unlike the previous `setSeconds` this cannot mutate the
  // caller's Date when the buffer is 0.
  const bufferExpiry = (
    bufferStartTime > 0 ? now.plus({ hours: bufferStartTime }) : now
  ).set({ second: 0, millisecond: 0 });

  // Check up to 14 days ahead, starting tomorrow. `plus({ days })` steps by
  // calendar day in `timeZone`, so it stays correct across a DST boundary.
  for (let dayOffset = 1; dayOffset <= 14; dayOffset++) {
    const checkDay = now.plus({ days: dayOffset });
    const daySchedule = resolveDaySchedule(checkDay, workingHours);

    if (
      !daySchedule?.isOpen ||
      !daySchedule.openTime ||
      !daySchedule.closeTime
    ) {
      continue;
    }

    const workingDayStart = atWallClock(checkDay, daySchedule.openTime);
    const workingDayEnd = atWallClock(checkDay, daySchedule.closeTime);

    // Use whichever is later: buffer expiry time or working day start
    const startTime =
      bufferExpiry > workingDayStart ? bufferExpiry : workingDayStart;

    // If start time is beyond this working day's end, close on the start day
    let endTime = workingDayEnd;
    if (startTime >= workingDayEnd) {
      const startDaySchedule = resolveDaySchedule(startTime, workingHours);
      endTime =
        startDaySchedule?.isOpen && startDaySchedule.closeTime
          ? atWallClock(startTime, startDaySchedule.closeTime)
          : // Fallback to 6 PM on start date
            atWallClock(startTime, "18:00");
    }

    return { startTime: startTime.toJSDate(), endTime: endTime.toJSDate() };
  }

  // Fallback: if no working day found, just use tomorrow 9 AM - 6 PM
  const tomorrow = now.plus({ days: 1 });
  const fallbackStart = atWallClock(tomorrow, "09:00");
  const fallbackEnd = atWallClock(tomorrow, "18:00");

  // Use whichever is later: buffer expiry time or fallback start
  const finalStartTime =
    bufferExpiry > fallbackStart ? bufferExpiry : fallbackStart;

  // If start time is beyond fallback end, set end to start day's 6 PM
  const finalEndTime =
    finalStartTime >= fallbackEnd
      ? atWallClock(finalStartTime, "18:00")
      : fallbackEnd;

  return {
    startTime: finalStartTime.toJSDate(),
    endTime: finalEndTime.toJSDate(),
  };
}

interface DefaultTimesResult {
  startDate: string;
  endDate: string;
}

/**
 * Calculates default start and end times for bookings based on working hours data and buffer time.
 * If working hours are disabled or not provided, it falls back to the original logic.
 * If working hours are enabled, it checks today's schedule and overrides to determine the next available booking time.
 * Buffer time is applied from current time - the start time will be whichever is later: buffer expiry or next available working time.
 *
 * For ADMIN/OWNER users, buffer time restrictions are automatically bypassed (effective buffer = 0).
 *
 * Every calendar-day and wall-clock decision here is made in the acting user's
 * PREFERENCE zone, which is the zone the form field displays and the server
 * parses in. Computing them on the device clock made the default wrong by the
 * offset between the two — and, when they straddled midnight, selected another
 * day's working hours entirely.
 *
 * @param workingHoursData - The working hours data containing weekly schedules and overrides.
 * @param bufferStartTime - Buffer time in hours from current time. Bypassed for admin/owner users.
 * @param isAdminOrOwner - Whether the user is an ADMIN or OWNER (bypasses buffer time restrictions).
 * @param prefs - The acting user's resolved format prefs. Typed as
 *   {@link ResolvedFormatPrefs} rather than a bare zone string so a browser-hint
 *   object (`{ locale, timeZone }`) cannot satisfy it — the device zone is
 *   exactly the wrong answer here, and that mistake is what this fixes.
 * @returns An object containing the start and end dates formatted for date input values.
 */
export function getBookingDefaultStartEndTimes(
  workingHoursData: WorkingHoursData | null | undefined,
  bufferStartTime: number,
  isAdminOrOwner: boolean,
  prefs: ResolvedFormatPrefs
): DefaultTimesResult {
  const { timeZone } = prefs;
  const nowInstant = new Date();
  const now = DateTime.fromJSDate(nowInstant).setZone(timeZone);

  // Admin/Owner users bypass buffer time restrictions
  const effectiveBufferStartTime = isAdminOrOwner ? 0 : bufferStartTime;

  // If no working hours data or working hours are disabled, use the original logic
  if (!workingHoursData || !workingHoursData.enabled) {
    return getOriginalDefaultTimes(
      nowInstant,
      effectiveBufferStartTime,
      timeZone
    );
  }

  const todaySchedule = resolveDaySchedule(now, workingHoursData);

  // Current time as HH:MM in the preference zone, for comparison against the
  // org's window (which is itself expressed as a wall clock).
  const currentTimeString = now.toFormat("HH:mm");

  // Check if we're currently in working hours
  const isCurrentlyInWorkingHours =
    todaySchedule?.isOpen &&
    todaySchedule.openTime &&
    todaySchedule.closeTime &&
    currentTimeString >= todaySchedule.openTime &&
    currentTimeString < todaySchedule.closeTime;

  if (isCurrentlyInWorkingHours && todaySchedule.closeTime) {
    // We're in working hours - use whichever is later: buffer expiry or 10 minutes from now
    const earliestStartTime = (
      effectiveBufferStartTime > 0
        ? now.plus({ hours: effectiveBufferStartTime })
        : now.plus({ minutes: 10 })
    ).set({ second: 0, millisecond: 0 });

    const endDateTime = atWallClock(now, todaySchedule.closeTime);

    // If start time is beyond today's close time, find next working day
    if (earliestStartTime >= endDateTime) {
      const nextWorkingDay = findNextWorkingDay(
        earliestStartTime.toJSDate(),
        workingHoursData,
        0,
        timeZone
      );
      return {
        startDate: dateForDateTimeInputValue(
          nextWorkingDay.startTime,
          timeZone
        ),
        endDate: dateForDateTimeInputValue(nextWorkingDay.endTime, timeZone),
      };
    }

    return {
      startDate: dateForDateTimeInputValue(
        earliestStartTime.toJSDate(),
        timeZone
      ),
      endDate: dateForDateTimeInputValue(endDateTime.toJSDate(), timeZone),
    };
  } else {
    // We're outside working hours - find the next working day
    const nextWorkingDay = findNextWorkingDay(
      nowInstant,
      workingHoursData,
      effectiveBufferStartTime,
      timeZone
    );

    return {
      startDate: dateForDateTimeInputValue(nextWorkingDay.startTime, timeZone),
      endDate: dateForDateTimeInputValue(nextWorkingDay.endTime, timeZone),
    };
  }
}

/**
 * Defaults for orgs with working hours disabled: start shortly from now, end at
 * 6 PM. Like its working-hours sibling, "6 PM" and "next day" are read in
 * `timeZone`, not on the device clock.
 *
 * @param nowInstant - Current instant.
 * @param bufferStartTime - Buffer in hours; 0 uses the 10-minute rule.
 * @param timeZone - IANA zone that defines the wall clock and calendar day.
 * @returns Start/end formatted for a datetime-local input.
 */
function getOriginalDefaultTimes(
  nowInstant: Date,
  bufferStartTime: number,
  timeZone: string
): DefaultTimesResult {
  const now = DateTime.fromJSDate(nowInstant).setZone(timeZone);

  // Original logic for backward compatibility with buffer support
  const startDateTime = (
    bufferStartTime > 0
      ? now.plus({ hours: bufferStartTime })
      : // Use original 10-minute logic when buffer is 0
        now.plus({ minutes: 10 })
  ).set({ second: 0, millisecond: 0 });

  const startDate = dateForDateTimeInputValue(
    startDateTime.toJSDate(),
    timeZone
  );

  // Use the start time for end date logic, not the original current time
  const isAtOrNearSixPm =
    startDateTime.hour >= 18 ||
    (startDateTime.hour === 17 && startDateTime.minute > 49);

  // After 6 PM (or close to it) the booking runs to 6 PM the NEXT day;
  // otherwise it ends at 6 PM the same day.
  const endDateTime = atWallClock(
    isAtOrNearSixPm ? startDateTime.plus({ days: 1 }) : startDateTime,
    "18:00"
  );

  return {
    startDate,
    endDate: dateForDateTimeInputValue(endDateTime.toJSDate(), timeZone),
  };
}

/**
 * Calculates the effective end date for a booking by extending the duration
 * to skip closed days when maxBookingLengthSkipClosedDays is enabled.
 *
 * @param startDate - The start date of the booking
 * @param endDate - The end date of the booking
 * @param workingHoursData - Working hours configuration with schedules and overrides
 * @param skipClosedDays - Whether to skip closed days in the calculation
 * @param timeZone - IANA zone that decides which calendar day the walk is on.
 *   Same contract as {@link calculateBusinessHoursDuration}.
 * @returns Effective end date for validation (or original endDate if not skipping)
 */
export function calculateEffectiveEndDate(
  startDate: Date,
  endDate: Date,
  workingHoursData: WorkingHoursData | null | undefined,
  skipClosedDays: boolean,
  timeZone: string
): Date {
  // If not skipping closed days or no working hours data, use original endDate
  if (!skipClosedDays || !workingHoursData?.enabled) {
    return endDate;
  }

  let closedDaysCount = 0;
  let cursor = DateTime.fromJSDate(startDate).setZone(timeZone);
  const end = DateTime.fromJSDate(endDate).setZone(timeZone);

  // Count closed days between start and original end date
  while (cursor < end) {
    // Which day this is, and whether it is open, are decided in `timeZone` —
    // see the shared resolver. Reading them off a device-local Date put the
    // count on the wrong days whenever the device and preference zones
    // straddled midnight.
    const isOpen =
      resolveDaySchedule(cursor, workingHoursData)?.isOpen ?? false;

    if (!isOpen) {
      closedDaysCount++;
    }

    // Move to next day. `plus({ days })` steps by calendar day in `timeZone`,
    // so the walk stays correct across a DST boundary.
    cursor = cursor.plus({ days: 1 });
  }

  // Extend the end date by the number of closed days
  return end.plus({ days: closedDaysCount }).toJSDate();
}

/**
 * Calculates the effective booking duration by subtracting closed days from calendar hours.
 *
 * Example: Fri 3PM → Mon 3PM = 72 calendar hours
 * If Sat/Sun closed: 72 hours - 48 hours (2 closed days) = 24 hours
 *
 * @param startDate - The start date of the booking
 * @param endDate - The end date of the booking
 * @param workingHoursData - Working hours configuration with schedules and overrides
 * @param timeZone - IANA zone that decides which calendar day each hour belongs
 *   to, and where midnight falls. Pass the acting user's resolved preference
 *   zone — see `.claude/rules/working-hours-are-location-local.md` for why that
 *   is the accepted proxy, and why leaving it to the ambient clock is worse
 *   (it differs between the browser and the server for the same submission).
 * @returns Calendar hours minus closed days hours
 */
export function calculateBusinessHoursDuration(
  startDate: Date,
  endDate: Date,
  workingHoursData: WorkingHoursData,
  timeZone: string
): number {
  // Total calendar hours is pure instant arithmetic — no zone involved.
  const totalCalendarHours = differenceInHours(endDate, startDate);
  let closedDaysHours = 0;

  let cursor = DateTime.fromJSDate(startDate).setZone(timeZone);
  const end = DateTime.fromJSDate(endDate).setZone(timeZone);

  // Process each day from start to end to count closed days
  while (cursor < end) {
    // Midnight is a WALL-CLOCK boundary, so it has to be taken in `timeZone`.
    // `setHours(0,0,0,0)` cut the day on the device clock, which sliced the
    // window on the wrong boundary for anyone whose device differed from their
    // preference zone — and shifted how many hours got attributed to a closed
    // day.
    const nextDay = cursor.plus({ days: 1 }).startOf("day");

    // Intersection of the booking with this day
    const windowEnd = nextDay > end ? end : nextDay;

    const isOpen =
      resolveDaySchedule(cursor, workingHoursData)?.isOpen ?? false;

    if (!isOpen) {
      // This day is closed, subtract its hours from the total. Kept on
      // `differenceInHours` so the truncation matches the calendar-hours total
      // it is subtracted from.
      closedDaysHours += differenceInHours(
        windowEnd.toJSDate(),
        cursor.toJSDate()
      );
    }

    cursor = nextDay;
  }

  return totalCalendarHours - closedDaysHours;
}
