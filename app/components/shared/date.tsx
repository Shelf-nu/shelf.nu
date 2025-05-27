import { getDateTimeFormatFromHints, useHints } from "~/utils/client-hints";

/**
 * Component that renders date based on the users locale and timezone.
 * This is used on client side so we assume that the date is always string due to loader data serialization.
 * Can optionally display time along with the date.
 */
export const DateS = ({
  date,
  options,
  includeTime = false,
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
}) => {
  const hints = useHints();
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
