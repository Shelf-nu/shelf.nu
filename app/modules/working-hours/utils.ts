import { addHours, addDays, format, differenceInHours } from "date-fns";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import type {
  DaySchedule,
  WeeklyScheduleJson,
  WorkingHoursData,
} from "./types";

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
        date:
          override.date instanceof Date
            ? override.date.toISOString()
            : String(override.date),
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
 * @param currentDate - The date from which to start searching for the next working day.
 * @param workingHours - The working hours data containing weekly schedules and overrides.
 * @param bufferStartTime - Buffer time in hours from current time.
 * @returns An object containing the start and end times of the next working day.
 */
function findNextWorkingDay(
  currentDate: Date,
  workingHours: WorkingHoursData,
  bufferStartTime: number
): NextWorkingDayResult {
  // Calculate buffer expiry time (current time + buffer hours)
  const bufferExpiryTime =
    bufferStartTime > 0 ? addHours(currentDate, bufferStartTime) : currentDate;
  // Remove seconds and milliseconds
  bufferExpiryTime.setSeconds(0, 0);

  // Start checking from tomorrow
  const searchDate = new Date(currentDate);
  searchDate.setDate(searchDate.getDate() + 1);

  // Check up to 14 days to find next working day
  for (let i = 0; i < 14; i++) {
    const checkDate = new Date(searchDate);
    checkDate.setDate(searchDate.getDate() + i);

    const dateString = checkDate.toISOString().split("T")[0]; // YYYY-MM-DD format
    const dayOfWeek = checkDate.getDay().toString();

    // Check for date-specific override first
    const override = workingHours.overrides.find((override) => {
      const overrideDate = new Date(override.date).toISOString().split("T")[0];
      return overrideDate === dateString;
    });

    let daySchedule: DaySchedule | null = null;

    if (override) {
      // Use override schedule
      daySchedule = {
        isOpen: override.isOpen,
        openTime: override.openTime || undefined,
        closeTime: override.closeTime || undefined,
      };
    } else {
      // Use regular weekly schedule
      daySchedule = workingHours.weeklySchedule[dayOfWeek] || null;
    }

    if (daySchedule?.isOpen && daySchedule.openTime && daySchedule.closeTime) {
      const [openHours, openMinutes] = daySchedule.openTime
        .split(":")
        .map(Number);
      const [closeHours, closeMinutes] = daySchedule.closeTime
        .split(":")
        .map(Number);

      const workingDayStart = new Date(checkDate);
      workingDayStart.setHours(openHours, openMinutes, 0, 0);

      const workingDayEnd = new Date(checkDate);
      workingDayEnd.setHours(closeHours, closeMinutes, 0, 0);

      // Use whichever is later: buffer expiry time or working day start
      const startTime =
        bufferExpiryTime > workingDayStart ? bufferExpiryTime : workingDayStart;

      // If start time is beyond this working day's end, find next working day for end time
      let endTime = workingDayEnd;
      if (startTime >= workingDayEnd) {
        // Find working hours for the start time's date
        const startDateString = startTime.toISOString().split("T")[0];
        const startDayOfWeek = startTime.getDay().toString();

        // Check for override on start date
        const startDayOverride = workingHours.overrides.find((override) => {
          const overrideDate = new Date(override.date)
            .toISOString()
            .split("T")[0];
          return overrideDate === startDateString;
        });

        let startDaySchedule: DaySchedule | null = null;
        if (startDayOverride) {
          startDaySchedule = {
            isOpen: startDayOverride.isOpen,
            openTime: startDayOverride.openTime || undefined,
            closeTime: startDayOverride.closeTime || undefined,
          };
        } else {
          startDaySchedule =
            workingHours.weeklySchedule[startDayOfWeek] || null;
        }

        if (startDaySchedule?.isOpen && startDaySchedule.closeTime) {
          const [startDayCloseHours, startDayCloseMinutes] =
            startDaySchedule.closeTime.split(":").map(Number);
          endTime = new Date(startTime);
          endTime.setHours(startDayCloseHours, startDayCloseMinutes, 0, 0);
        } else {
          // Fallback to 6 PM on start date
          endTime = new Date(startTime);
          endTime.setHours(18, 0, 0, 0);
        }
      }

      return { startTime, endTime };
    }
  }

  // Fallback: if no working day found, just use tomorrow 9 AM - 6 PM
  const fallbackStart = new Date(currentDate);
  fallbackStart.setDate(fallbackStart.getDate() + 1);
  fallbackStart.setHours(9, 0, 0, 0);

  const fallbackEnd = new Date(currentDate);
  fallbackEnd.setDate(fallbackEnd.getDate() + 1);
  fallbackEnd.setHours(18, 0, 0, 0);

  // Use whichever is later: buffer expiry time or fallback start
  const finalStartTime =
    bufferExpiryTime > fallbackStart ? bufferExpiryTime : fallbackStart;

  // If start time is beyond fallback end, set end to start day's 6 PM
  let finalEndTime = fallbackEnd;
  if (finalStartTime >= fallbackEnd) {
    finalEndTime = new Date(finalStartTime);
    finalEndTime.setHours(18, 0, 0, 0);
  }

  return { startTime: finalStartTime, endTime: finalEndTime };
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
 * @param workingHoursData - The working hours data containing weekly schedules and overrides.
 * @param bufferStartTime - Buffer time in hours from current time. Bypassed for admin/owner users.
 * @param isAdminOrOwner - Whether the user is an ADMIN or OWNER (bypasses buffer time restrictions).
 * @returns An object containing the start and end dates formatted for date input values.
 */
export function getBookingDefaultStartEndTimes(
  workingHoursData: WorkingHoursData | null | undefined,
  bufferStartTime: number,
  isAdminOrOwner: boolean
): DefaultTimesResult {
  const now = new Date();

  // Admin/Owner users bypass buffer time restrictions
  const effectiveBufferStartTime = isAdminOrOwner ? 0 : bufferStartTime;

  // If no working hours data or working hours are disabled, use the original logic
  if (!workingHoursData || !workingHoursData.enabled) {
    return getOriginalDefaultTimes(now, effectiveBufferStartTime);
  }

  // Get today's date and schedule
  const todayDateString = now.toISOString().split("T")[0]; // YYYY-MM-DD format
  const todayDayOfWeek = now.getDay().toString();

  // Check for date-specific override first
  const todayOverride = workingHoursData.overrides.find((override) => {
    const overrideDate = new Date(override.date).toISOString().split("T")[0];
    return overrideDate === todayDateString;
  });

  let todaySchedule: DaySchedule | null = null;

  if (todayOverride) {
    // Use override schedule
    todaySchedule = {
      isOpen: todayOverride.isOpen,
      openTime: todayOverride.openTime || undefined,
      closeTime: todayOverride.closeTime || undefined,
    };
  } else {
    // Use regular weekly schedule
    todaySchedule = workingHoursData.weeklySchedule[todayDayOfWeek] || null;
  }

  // Current time as HH:MM string for comparison
  const currentTimeString = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;

  // Check if we're currently in working hours
  const isCurrentlyInWorkingHours =
    todaySchedule?.isOpen &&
    todaySchedule.openTime &&
    todaySchedule.closeTime &&
    currentTimeString >= todaySchedule.openTime &&
    currentTimeString < todaySchedule.closeTime;

  if (isCurrentlyInWorkingHours && todaySchedule.closeTime) {
    // We're in working hours - use whichever is later: buffer expiry or 10 minutes from now
    let earliestStartTime: Date;

    if (effectiveBufferStartTime > 0) {
      // Use buffer time from current time
      earliestStartTime = addHours(now, effectiveBufferStartTime);
    } else {
      // Use original 10-minute logic when buffer is 0
      earliestStartTime = new Date(now);
      earliestStartTime.setMinutes(now.getMinutes() + 10, 0);
    }

    // Remove seconds and milliseconds
    earliestStartTime.setSeconds(0, 0);

    const [closeHours, closeMinutes] = todaySchedule.closeTime
      .split(":")
      .map(Number);
    const endDateTime = new Date(now);
    endDateTime.setHours(closeHours, closeMinutes, 0, 0);

    // If start time is beyond today's close time, find next working day
    if (earliestStartTime >= endDateTime) {
      const nextWorkingDay = findNextWorkingDay(
        earliestStartTime,
        workingHoursData,
        0
      );
      return {
        startDate: dateForDateTimeInputValue(nextWorkingDay.startTime),
        endDate: dateForDateTimeInputValue(nextWorkingDay.endTime),
      };
    }

    return {
      startDate: dateForDateTimeInputValue(earliestStartTime),
      endDate: dateForDateTimeInputValue(endDateTime),
    };
  } else {
    // We're outside working hours - find the next working day
    const nextWorkingDay = findNextWorkingDay(
      now,
      workingHoursData,
      effectiveBufferStartTime
    );

    return {
      startDate: dateForDateTimeInputValue(nextWorkingDay.startTime),
      endDate: dateForDateTimeInputValue(nextWorkingDay.endTime),
    };
  }
}

function getOriginalDefaultTimes(
  now: Date,
  bufferStartTime: number
): DefaultTimesResult {
  // Original logic for backward compatibility with buffer support
  let startDateTime: Date;

  if (bufferStartTime > 0) {
    // Use buffer time from current time
    startDateTime = addHours(now, bufferStartTime);
  } else {
    // Use original 10-minute logic when buffer is 0
    startDateTime = new Date(now);
    startDateTime.setMinutes(now.getMinutes() + 10, 0);
  }

  // Remove seconds and milliseconds
  startDateTime.setSeconds(0, 0);

  const startDate = dateForDateTimeInputValue(startDateTime);

  let endDate: string;

  // Use the start time for end date logic, not the original current time
  const referenceTime = startDateTime;

  if (
    referenceTime.getHours() >= 18 ||
    (referenceTime.getHours() === 17 && referenceTime.getMinutes() > 49)
  ) {
    // If start time is after 6 PM (or close to it), set end to 6 PM next day
    const endDateTime = new Date(referenceTime);
    endDateTime.setDate(endDateTime.getDate() + 1);
    endDateTime.setHours(18, 0, 0, 0);
    endDate = dateForDateTimeInputValue(endDateTime);
  } else {
    // If start time is before 6 PM, set end to 6 PM same day
    const endDateTime = new Date(referenceTime);
    endDateTime.setHours(18, 0, 0, 0);
    endDate = dateForDateTimeInputValue(endDateTime);
  }

  return { startDate, endDate };
}

/**
 * Calculates the effective end date for a booking by extending the duration
 * to skip closed days when maxBookingLengthSkipClosedDays is enabled.
 *
 * @param startDate - The start date of the booking
 * @param endDate - The end date of the booking
 * @param workingHoursData - Working hours configuration with schedules and overrides
 * @param skipClosedDays - Whether to skip closed days in the calculation
 * @returns Effective end date for validation (or original endDate if not skipping)
 */
export function calculateEffectiveEndDate(
  startDate: Date,
  endDate: Date,
  workingHoursData: WorkingHoursData | null | undefined,
  skipClosedDays: boolean
): Date {
  // If not skipping closed days or no working hours data, use original endDate
  if (!skipClosedDays || !workingHoursData?.enabled) {
    return endDate;
  }

  let closedDaysCount = 0;
  const currentDate = new Date(startDate);
  const originalEndDate = new Date(endDate);

  // Count closed days between start and original end date
  while (currentDate < originalEndDate) {
    const dateString = format(currentDate, "yyyy-MM-dd");
    const dayOfWeek = currentDate.getDay().toString();

    // Check for date-specific override first
    const override = workingHoursData.overrides.find((override) => {
      const overrideDate = format(override.date, "yyyy-MM-dd");
      return overrideDate === dateString;
    });

    let isOpen: boolean;

    if (override) {
      isOpen = override.isOpen;
    } else {
      const daySchedule = workingHoursData.weeklySchedule[dayOfWeek];
      isOpen = daySchedule?.isOpen || false;
    }

    // If this day is closed, count it
    if (!isOpen) {
      closedDaysCount++;
    }

    // Move to next day
    currentDate.setTime(addDays(currentDate, 1).getTime());
  }

  // Extend the end date by the number of closed days
  const finalEndDate = addDays(originalEndDate, closedDaysCount);

  return finalEndDate;
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
 * @returns Calendar hours minus closed days hours
 */
export function calculateBusinessHoursDuration(
  startDate: Date,
  endDate: Date,
  workingHoursData: WorkingHoursData
): number {
  // Start with total calendar hours
  const totalCalendarHours = differenceInHours(endDate, startDate);
  let closedDaysHours = 0;

  const currentDate = new Date(startDate);

  // Process each day from start to end to count closed days
  while (currentDate < endDate) {
    const nextDay = addDays(currentDate, 1);
    nextDay.setHours(0, 0, 0, 0); // Start of next day

    // Get the actual time window for this day (intersection of booking with day)
    const windowStart = currentDate;
    const windowEnd = nextDay > endDate ? endDate : nextDay;

    // Check if this day is closed
    const dateString = format(windowStart, "yyyy-MM-dd");
    const dayOfWeek = windowStart.getDay().toString();

    // Check for date-specific override first
    const override = workingHoursData.overrides.find((override) => {
      const overrideDate = format(override.date, "yyyy-MM-dd");
      return overrideDate === dateString;
    });

    let isOpen: boolean;
    if (override) {
      isOpen = override.isOpen;
    } else {
      const daySchedule = workingHoursData.weeklySchedule[dayOfWeek];
      isOpen = daySchedule?.isOpen || false;
    }

    if (!isOpen) {
      // This day is closed, subtract its hours from the total
      const hoursInThisDay = differenceInHours(windowEnd, windowStart);
      closedDaysHours += hoursInThisDay;
    }

    // Move to next day
    currentDate.setTime(nextDay.getTime());
  }

  const effectiveHours = totalCalendarHours - closedDaysHours;

  return effectiveHours;
}
