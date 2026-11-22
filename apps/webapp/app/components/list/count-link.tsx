/**
 * Count Link
 *
 * A number in a list cell that opens the list it counts (a location's assets,
 * a tag's bookings, an audit's missing assets). Styled as gray underlined
 * text so it reads as part of the table rather than as a call to action.
 *
 * @see {@link file://./../../routes/_layout+/locations._index.tsx}
 * @see {@link file://./../../routes/_layout+/tags.tsx}
 * @see {@link file://./../../routes/_layout+/audits._index.tsx}
 */
import { Button } from "../shared/button";

/**
 * Renders `count` as a link to `to`. Zero has nothing to open, so it stays
 * plain text.
 *
 * @param props.count - The number to show
 * @param props.to - The page listing the counted records
 * @param props.label - What the link opens, e.g. "View the assets in
 *   Warehouse". Read to assistive tech after the count, so the link's name
 *   still starts with the number sighted users see (WCAG 2.5.3).
 */
export function CountLink({
  count,
  to,
  label,
}: {
  count: number;
  to: string;
  label: string;
}) {
  if (count === 0) {
    return <>{count}</>;
  }

  return (
    <Button to={to} variant="link-gray">
      {count}
      <span className="sr-only">, {label}</span>
    </Button>
  );
}
