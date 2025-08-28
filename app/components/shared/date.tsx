import { format } from "date-fns";
import { getDateTimeFormatFromHints, useHints } from "~/utils/client-hints";

/**
 * Formats a date using locale-specific formatting without timezone conversion.
 * Used for absolute dates that should display exactly as stored (e.g., working hours overrides).
 */
function formatAbsoluteDate(
  date: string | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  // Extract just the date part and create a local date
  let dateToFormat: Date;
  if (typeof date === "string") {
    // Extract date-only part if it's a datetime string
    const dateOnly = date.includes("T") ? date.split("T")[0] : date;
    // Parse as local date components to completely avoid timezone interpretation
    const [year, month, day] = dateOnly.split("-").map(Number);
    dateToFormat = new Date(year, month - 1, day);
  } else {
    dateToFormat = date;
  }

  // Convert Intl.DateTimeFormatOptions to date-fns format string
  let formatString: string;

  if (options) {
    let parts = [];

    // Build format parts in logical order
    if (options.weekday === "long") parts.push("EEEE");
    else if (options.weekday === "short") parts.push("EEE");
    else if (options.weekday === "narrow") parts.push("EEEEE");

    // Month and day should be together without comma
    let datePartFormat = "";
    if (options.month === "long") datePartFormat += "MMMM";
    else if (options.month === "short") datePartFormat += "MMM";
    else if (options.month === "numeric") datePartFormat += "M";
    else if (options.month === "2-digit") datePartFormat += "MM";

    if (options.day === "numeric") datePartFormat += " d";
    else if (options.day === "2-digit") datePartFormat += " dd";

    if (datePartFormat) parts.push(datePartFormat);

    if (options.year === "numeric") parts.push("yyyy");
    else if (options.year === "2-digit") parts.push("yy");

    if (parts.length > 0) {
      formatString = parts.join(", ");
    } else {
      // Fallback if no valid parts found
      formatString = "PPP"; // date-fns long localized date format
    }
  } else {
    // Default locale-aware format when no options provided
    // Use date-fns localized format that adapts to locale
    // PPP = long localized date format (e.g., "April 29th, 2023" in en-US, "29 avril 2023" in fr-FR)
    formatString = "PPP";
  }

  return format(dateToFormat, formatString);
}

/**
 * Component that renders date based on the users locale and timezone.
 * This is used on client side so we assume that the date is always string due to loader data serialization.
 * Can optionally display time along with the date.
 */
export const DateS = ({
  date,
  options,
  includeTime = false,
  localeOnly = false,
}: {
  date: string | Date;
  /**
   * Options to pass to Intl.DateTimeFormat
   * Default values are { year: 'numeric', month: 'numeric', day: 'numeric' }
   * You can pass any options that Intl.DateTimeFormat accepts
   */
  options?: Intl.DateTimeFormatOptions;
  /**
   * Whether to include time in the formatted date
   * When true, adds time formatting options (hour, minute) to the date format
   */
  includeTime?: boolean;
  /**
   * Whether to format the date based on locale only, without timezone conversion.
   * Use this for absolute dates like working hours overrides that represent
   * real-world, location-specific dates that should not change based on user timezone.
   */
  localeOnly?: boolean;
}) => {
  const hints = useHints();

  // Handle locale-only formatting (no timezone conversion)
  if (localeOnly) {
    if (includeTime) {
      // eslint-disable-next-line no-console
      console.warn("includeTime is not supported with localeOnly formatting");
    }

    const formattedDate = formatAbsoluteDate(date, options);
    return <span>{formattedDate}</span>;
  }

  // Standard timezone-aware formatting
  let d = date;
  if (typeof date === "string") {
    d = new Date(date);
  }

  // If includeTime is true and no time options have been explicitly provided,
  // add default time formatting options
  const timeOptions: Intl.DateTimeFormatOptions = includeTime
    ? {
        hour: "numeric",
        minute: "numeric",
        ...options,
      }
    : options || {};

  const formattedDate = getDateTimeFormatFromHints(hints, timeOptions).format(
    new Date(d)
  );

  return <span>{formattedDate}</span>;
};
