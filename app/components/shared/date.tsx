import { getDateTimeFormatFromHints, useHints } from "~/utils/client-hints";

/**
 * Component that renders date based on the users locale and timezone.
 * This is used on client side so we assume that the date is alaways string due to loader data serialization.
 */
export const DateS = ({
  date,
  options,
}: {
  date: string | Date;
  /**
   * Options to pass to Intl.DateTimeFormat
   * Default values are { year: 'numeric', month: 'numeric', day: 'numeric' }
   * You can passs any options that Intl.DateTimeFormat accepts
   * */
  options?: Intl.DateTimeFormatOptions;
}) => {
  const hints = useHints();
  let d = date;

  if (typeof date === "string") {
    d = new Date(date);
  }

  const formattedDate = getDateTimeFormatFromHints(hints, options).format(
    new Date(d)
  );

  return <span>{formattedDate}</span>;
};
