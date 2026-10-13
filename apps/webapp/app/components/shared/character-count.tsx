import { tw } from "~/utils/tw";

/**
 * Shows how many characters a field holds against its limit, for example
 * "1,510 / 5,000". Turns red once the count is over the limit, so the user can
 * see why a save is refused.
 *
 * Display only: it never stops the user typing. The limit is enforced by the
 * field's validation.
 */
export function CharacterCount({
  count,
  max,
  className,
  id,
}: {
  /** Characters the field currently holds */
  count: number;
  /** The most characters the field accepts */
  max: number;
  className?: string;
  /** Lets the field point at the counter with `aria-describedby`. */
  id?: string;
}) {
  const isOver = count > max;
  return (
    <span
      id={id}
      className={tw(
        "text-xs tabular-nums",
        isOver ? "text-error-600" : "text-gray-500",
        className
      )}
      aria-live="polite"
      data-testid="character-count"
    >
      {count.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}
