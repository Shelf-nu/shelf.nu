import type { ClientHint } from "~/modules/booking/types";
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

export function getBookingDefaultStartEndTimes() {
  const now = new Date();

  /** Add 10 minutes to current time */
  const startDate = dateForDateTimeInputValue(
    new Date(now.setMinutes(now.getMinutes() + 10, 0))
  );

  let endDate;
  /** If its already after 6pm, set it to 6pm tomorrow */
  if (
    now.getHours() >= 18 ||
    (now.getHours() === 17 && now.getMinutes() > 49)
  ) {
    now.setDate(now.getDate() + 1);
    endDate = dateForDateTimeInputValue(new Date(now.setHours(18, 0, 0)));
  } else {
    /** Set to 6pm today */
    endDate = dateForDateTimeInputValue(new Date(now.setHours(18, 0, 0)));
  }

  return { startDate, endDate };
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
