import { useDateFormatter } from "~/hooks/use-date-formatter";

interface TimeDisplayProps {
  time: string; // HH:MM format (24-hour)
  className?: string;
}

/**
 * Component that displays time in the user's preferred format (12h/24h based on locale)
 * Takes 24-hour format input and converts to locale-appropriate display
 */
export const TimeDisplay = ({ time, className }: TimeDisplayProps) => {
  const { formatTime } = useDateFormatter();

  if (!time) return null;

  try {
    // Wall-clock working-hours time (HH:MM, 24h). Render in the user's
    // configured time format WITHOUT timezone conversion (localeOnly) — the
    // value is already the workspace-local open/close time, not a UTC instant.
    const timeDate = new Date(`2000-01-01T${time}:00`);
    return (
      <span className={className}>
        {formatTime(timeDate, { localeOnly: true })}
      </span>
    );
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
