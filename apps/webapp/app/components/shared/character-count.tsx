import { tw } from "~/utils/tw";

/**
 * Shows how many characters a field holds against its limit, for example
 * "1,510 / 5,000". Turns red once the count is over the limit, so the user can
 * see why a save is refused.
 *
 * Display only: it never stops the user typing. The limit is enforced by the
 * field's validation.
 *
 * The visible count is not a live region, because it changes on every
 * keystroke; the field points at it with `aria-describedby`, so the count is
 * read when the field is focused. A separate, visually hidden live region
 * speaks once, when the text crosses the limit. It stays mounted with empty
 * text below the limit, because a region added to the page already holding
 * text is not announced.
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
  const maxLabel = max.toLocaleString("en-US");
  return (
    <>
      <span
        id={id}
        className={tw(
          "text-xs tabular-nums",
          isOver ? "text-error-600" : "text-gray-500",
          className
        )}
        data-testid="character-count"
      >
        {count.toLocaleString("en-US")} / {maxLabel}
      </span>
      <span className="sr-only" aria-live="polite">
        {isOver ? `Over the ${maxLabel} character limit` : ""}
      </span>
    </>
  );
}
