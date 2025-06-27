import { format, formatISO, parseISO } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "./client-hints";

export function getDifferenceInSeconds(
  dateLeft: Date,
  dateRight: Date
): number {
  const millisecondsDifference = Math.abs(
    dateLeft.getTime() - dateRight.getTime()
  );
  const secondsDifference = millisecondsDifference / 1000;
  return secondsDifference;
}

/** Prepares a date to be passed as default value for input with type `datetime-local` */
export const dateForDateTimeInputValue = (date: Date) => {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().slice(0, 19);
};

export function calcTimeDifference(
  date1: Date,
  date2: Date
): { hours: number; minutes: number } {
  // Calculate the time difference in milliseconds
  const diffInMs = Math.abs(date2.getTime() - date1.getTime());

  // Convert milliseconds to minutes and hours
  let minutes = Math.floor(diffInMs / (1000 * 60));
  let hours = Math.floor(minutes / 60);

  if (minutes >= 58) {
    hours++; //just to round it to hours
    minutes = 0;
  }

  return { hours, minutes };
}

export function getTimeRemainingMessage(date1: Date, date2: Date): string {
  // console.log("date1", date1);
  // console.log("date2", date2);
  const { hours, minutes } = calcTimeDifference(date1, date2);
  // console.log("hours", hours);
  // console.log("minutes", minutes);

  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  } else {
    return ""; //this should not happen
  }
}

export function formatDatesForICal(date: Date, hints: ClientHint) {
  const dateTimeFormat = getDateTimeFormatFromHints(hints, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const formatLocalDate = (date: Date, dateTimeFormat: Intl.DateTimeFormat) => {
    const parts = dateTimeFormat.formatToParts(date);
    const year = parts.find((part) => part.type === "year")!.value;
    const month = parts.find((part) => part.type === "month")!.value;
    const day = parts.find((part) => part.type === "day")!.value;
    const hour = parts.find((part) => part.type === "hour")!.value;
    const minute = parts.find((part) => part.type === "minute")!.value;
    const second = parts.find((part) => part.type === "second")!.value;
    return `${year}${month}${day}T${hour}${minute}${second}`;
  };

  return formatLocalDate(date, dateTimeFormat);
}

export function getWeekNumber(currentDate: Date) {
  const start = new Date(currentDate.getFullYear(), 0, 1);
  const diff = currentDate.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const day = Math.floor(diff / oneDay);
  const week = Math.ceil((day - currentDate.getDay() + 1) / 7);
  return week;
}

export function getWeekStartingAndEndingDates(currentDate: Date) {
  // Get the day of the week as a number (0 for Sunday, 1 for Monday, etc.)
  const day = currentDate.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1; // if day is Sunday(0), set diffToMonday as 6, else day - 1

  // Calculate the start of the week
  const start = new Date(currentDate);
  start.setDate(currentDate.getDate() - diffToMonday);

  // Calculate the end of the week
  const end = new Date(currentDate);
  end.setDate(start.getDate() + 6);

  // Format the dates as strings
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
  const startStr = start.toLocaleDateString(undefined, options);
  const endStr = end.toLocaleDateString(undefined, options);

  return [startStr, endStr];
}

/**
 * Type guard that checks if a value is a valid date string.
 * Used to validate and narrow types in TypeScript for date-related operations.
 *
 * @param value - Any value that needs to be checked for date string validity
 * @returns {boolean} True if the value is both a string and can be parsed into a valid date,
 *                    False if either the value is not a string or cannot be parsed into a valid date
 *
 * @example
 * isDateString("2024-01-01") // returns true
 * isDateString("invalid-date") // returns false
 * isDateString(123) // returns false
 *
 * @remarks
 * - Uses date-fns parseISO for date parsing which expects ISO 8601 format
 * - The function serves as a TypeScript type guard, helping narrow types in conditional blocks
 * - Returns false for any non-string input, even if it could theoretically represent a date
 * - Checks both string type and date validity to ensure complete validation
 */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const date = parseISO(value);
  return !isNaN(date.getTime());
}

/**
 * Converts a date string to UTC while preserving the local date components.
 * Handles timezone conversions to ensure consistent date storage and display.
 *
 * @param dateString - The date string to be converted (expected in ISO 8601 format)
 * @param timeZone - The source timezone for the conversion (e.g., "America/New_York")
 * @returns {string} A date string in 'yyyy-MM-dd' format, adjusted to UTC
 *
 * @example
 * adjustDateToUTC("2024-01-01", "America/New_York") // returns the UTC equivalent
 *
 * @remarks
 * - Uses date-fns-tz for timezone operations ensuring accurate conversions
 * - The returned date maintains the same calendar date in the local timezone
 * - Returns formatted string without time components to maintain date-only precision
 * - Assumes input dateString is valid - should be validated before calling this function
 *
 * @throws
 * - May throw if dateString is invalid and cannot be parsed
 * - May throw if timeZone string is invalid
 *
 * @see
 * - isDateString() for input validation
 * - date-fns-tz documentation for timezone handling details
 */
export function adjustDateToUTC(dateString: string, timeZone: string): string {
  const zonedDate = toZonedTime(parseISO(dateString), timeZone);
  const utcDate = fromZonedTime(zonedDate, timeZone);
  return format(utcDate, "yyyy-MM-dd");
}

/**
 * Converts a UTC date string to the user's local timezone for display.
 * This ensures dates are shown correctly in the user's local context.
 *
 * @param dateString - The UTC date string from the database
 * @param timeZone - The user's timezone (e.g., "America/New_York")
 * @returns {string} A date string in 'yyyy-MM-dd' format, adjusted to user timezone
 *
 * @example
 * adjustDateToUserTimezone("2024-01-01", "America/New_York") // returns local equivalent
 */
export function adjustDateToUserTimezone(
  dateString: string,
  timeZone: string
): string {
  // If the date string is empty or not a valid date format, return empty string
  if (!dateString || !isDateString(dateString)) {
    return "";
  }

  try {
    const date = toZonedTime(parseISO(dateString), timeZone);
    return format(date, "yyyy-MM-dd");
  } catch {
    return "";
  }
}

/**
 * Converts a UTC date (string or Date) to the user's local timezone as an ISO 8601 string.
 *
 * @param dateInput - The UTC date string or Date object
 * @param timeZone - The user's timezone (e.g., "America/New_York")
 * @returns {string} ISO 8601 string adjusted to the user's timezone (e.g. "2025-06-16T03:41:00-04:00")
 */
export function toIsoDateTimeToUserTimezone(
  dateInput: string | Date,
  timeZone: string
): string {
  if (!dateInput) return "";

  try {
    const date =
      typeof dateInput === "string" ? parseISO(dateInput) : dateInput;

    const zonedDate = toZonedTime(date, timeZone);

    // Return ISO 8601 string with timezone offset
    return formatISO(zonedDate, { representation: "complete" });
  } catch {
    return "";
  }
}

/**
 * Gets today's date in the user's timezone, formatted as YYYY-MM-DD.
 * Useful for setting minimum dates and default values.
 *
 * @param timeZone - The user's timezone
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export function getTodayInUserTimezone(timeZone: string): string {
  try {
    const now = new Date();
    const zonedDate = toZonedTime(now, timeZone);
    return format(zonedDate, "yyyy-MM-dd");
  } catch {
    // Fallback to local date if timezone conversion fails
    return format(new Date(), "yyyy-MM-dd");
  }
}

/**
 * Converts a UTC time string to the user's local timezone for display.
 * This ensures time strings are shown correctly in the user's local context.
 *
 * @param utcTimeString - The UTC time string from the database (e.g., "07:15")
 * @param timeZone - The user's timezone (e.g., "America/New_York")
 * @returns {string} A time string in 'HH:mm' format, adjusted to user timezone
 *
 * @example
 * adjustTimeToUserTimezone("07:15", "America/New_York") // returns local equivalent like "03:15"
 */
export function adjustTimeToUserTimezone(
  utcTimeString: string,
  timeZone: string
): string {
  if (!utcTimeString || !utcTimeString.includes(":")) {
    return "";
  }

  try {
    const [hours, minutes] = utcTimeString.split(":").map(Number);

    // Create a UTC date for today with the specified time
    const today = new Date();
    const utcDate = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
        hours,
        minutes
      )
    );

    // Convert to user's timezone
    const localDate = toZonedTime(utcDate, timeZone);
    return format(localDate, "HH:mm");
  } catch {
    return "";
  }
}
