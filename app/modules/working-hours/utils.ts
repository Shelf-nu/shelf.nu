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
  } catch (error) {
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
 * @returns An object containing the start and end times of the next working day.
 */
function findNextWorkingDay(
  currentDate: Date,
  workingHours: WorkingHoursData
): NextWorkingDayResult {
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

      const startTime = new Date(checkDate);
      startTime.setHours(openHours, openMinutes, 0, 0);

      const endTime = new Date(checkDate);
      endTime.setHours(closeHours, closeMinutes, 0, 0);

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

  return { startTime: fallbackStart, endTime: fallbackEnd };
}

interface DefaultTimesResult {
  startDate: string;
  endDate: string;
}

/**
 * Calculates default start and end times for bookings based on working hours data.
 * If working hours are disabled or not provided, it falls back to the original logic.
 * If working hours are enabled, it checks today's schedule and overrides to determine the next available booking time.
 * @param workingHoursData - The working hours data containing weekly schedules and overrides.
 * @returns An object containing the start and end dates formatted for date input values.
 */
export function getBookingDefaultStartEndTimes(
  workingHoursData?: WorkingHoursData | null
): DefaultTimesResult {
  const now = new Date();

  // If no working hours data or working hours are disabled, use the original logic
  if (!workingHoursData || !workingHoursData.enabled) {
    return getOriginalDefaultTimes(now);
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
    // We're in working hours - start 10 minutes from now, end at closing time
    const startDateTime = new Date(now);
    startDateTime.setMinutes(now.getMinutes() + 10, 0);

    const [closeHours, closeMinutes] = todaySchedule.closeTime
      .split(":")
      .map(Number);
    const endDateTime = new Date(now);
    endDateTime.setHours(closeHours, closeMinutes, 0, 0);

    return {
      startDate: dateForDateTimeInputValue(startDateTime),
      endDate: dateForDateTimeInputValue(endDateTime),
    };
  } else {
    // We're outside working hours - find the next working day
    const nextWorkingDay = findNextWorkingDay(now, workingHoursData);

    return {
      startDate: dateForDateTimeInputValue(nextWorkingDay.startTime),
      endDate: dateForDateTimeInputValue(nextWorkingDay.endTime),
    };
  }
}

function getOriginalDefaultTimes(now: Date): DefaultTimesResult {
  // Original logic for backward compatibility
  const startDateTime = new Date(now);
  startDateTime.setMinutes(now.getMinutes() + 10, 0); // Reset seconds

  const startDate = dateForDateTimeInputValue(startDateTime);

  let endDate: string;

  if (
    now.getHours() >= 18 ||
    (now.getHours() === 17 && now.getMinutes() > 49)
  ) {
    const endDateTime = new Date(now);
    endDateTime.setDate(endDateTime.getDate() + 1);
    endDateTime.setHours(18, 0, 0, 0);
    endDate = dateForDateTimeInputValue(endDateTime);
  } else {
    const endDateTime = new Date(now);
    endDateTime.setHours(18, 0, 0, 0);
    endDate = dateForDateTimeInputValue(endDateTime);
  }

  return { startDate, endDate };
}
