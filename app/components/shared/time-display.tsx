import { useHints } from "~/utils/client-hints";

interface TimeDisplayProps {
  time: string; // HH:MM format (24-hour)
  className?: string;
}

/**
 * Component that displays time in the user's preferred format (12h/24h based on locale)
 * Takes 24-hour format input and converts to locale-appropriate display
 */
export const TimeDisplay = ({ time, className }: TimeDisplayProps) => {
  const hints = useHints();

  if (!time) return null;

  try {
    // Create a date object with the time (using arbitrary date)
    const timeDate = new Date(`2000-01-01T${time}:00`);

    // Format according to user's locale preferences
    const formatter = new Intl.DateTimeFormat(hints.locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: hints.timeZone,
    });

    return <span className={className}>{formatter.format(timeDate)}</span>;
  } catch {
    // Fallback to original time if formatting fails
    return <span className={className}>{time}</span>;
  }
};

interface TimeRangeDisplayProps {
  openTime?: string;
  closeTime?: string;
  className?: string;
}

/**
 * Component that displays a time range with locale-aware formatting
 */
export const TimeRangeDisplay = ({
  openTime,
  closeTime,
  className,
}: TimeRangeDisplayProps) => {
  if (!openTime || !closeTime) {
    return <span className={className}>Open (times not specified)</span>;
  }

  return (
    <span className={className}>
      <TimeDisplay time={openTime} /> - <TimeDisplay time={closeTime} />
    </span>
  );
};
