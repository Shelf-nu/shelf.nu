/**
 * Color Badge Preview
 *
 * Shows how a category or tag badge will look while its color is being
 * chosen, with one line explaining why the badge is not the exact picked
 * color. Badges draw their background as the color at 20% and their text as
 * the color at half brightness, so the name stays readable on any color; the
 * picked color itself is what gets saved.
 *
 * Rendered below a form's field row, not inside `ColorInput`: the category and
 * tag forms align their fields to the bottom of one row, and anything stacked
 * under a single field pushes that field out of line.
 *
 * @see {@link file://./color-input.tsx}
 * @see {@link file://./../shared/tag.tsx}
 */
import { tw } from "~/utils/tw";
import { Tag } from "../shared/tag";

/** Props for {@link ColorBadgePreview} */
type ColorBadgePreviewProps = {
  /** The name as typed; a blank name shows "Untitled" */
  name: string;
  /** A valid `#rrggbb` color, or null for none yet (plain gray badge) */
  color: string | null;
  className?: string;
};

/**
 * Renders "Preview" with the live badge and the reason it is tinted.
 * `Tag` draws the same badge as the category `Badge` (without its dot), and
 * falls back to gray when there is no color, as tags without one do.
 */
export function ColorBadgePreview({
  name,
  color,
  className,
}: ColorBadgePreviewProps) {
  return (
    <div className={tw("mt-3 flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Preview</span>
        <Tag color={color ?? undefined}>{name.trim() || "Untitled"}</Tag>
      </div>
      <p className="text-sm text-gray-600">
        Badges use a light tint of your color with darker text, so the name
        stays readable. Your exact color is still saved.
      </p>
    </div>
  );
}
