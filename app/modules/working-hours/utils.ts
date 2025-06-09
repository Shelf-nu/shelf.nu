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
