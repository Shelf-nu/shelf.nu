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
 * under a single field pushes that field out of line. Forms hold the live
 * name and color with {@link useColorBadgePreview}.
 *
 * @see {@link file://./color-input.tsx}
 * @see {@link file://./../shared/tag.tsx}
 */
import { useState } from "react";
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
 * Renders "Preview" with the live badge and, while a color is set, the reason
 * it is tinted. With no color (a cleared tag color, or a half-typed hex)
 * nothing is tinted or saved, so the explanation is left out.
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
      {color ? (
        <p className="text-sm text-gray-600">
          Badges use a light tint of your color with darker text, so the name
          stays readable. Your exact color is still saved.
        </p>
      ) : null}
    </div>
  );
}

/** Arguments for {@link useColorBadgePreview}: the values as loaded */
type ColorBadgePreviewSource = {
  /** Identifies the loaded record; use a constant on "new" forms */
  entityId: string;
  /** The loaded name */
  name: string;
  /** The loaded color, or null/empty for none */
  color: string | null | undefined;
};

/**
 * Holds the live name and color a form shows in its {@link ColorBadgePreview}.
 *
 * The form updates them from its name input and `ColorInput`'s
 * `onColorChange`. The preview also follows the loader: these forms render
 * above the category or tag list, so the list's edit links, search and paging
 * reload the route without remounting it. A new record resets both values;
 * a new loaded color (a fresh random one on "new" forms) resets the color and
 * keeps the typed name, which its uncontrolled input keeps too.
 *
 * @param source - The loaded record id, name and color
 * @returns The preview values and their setters
 */
export function useColorBadgePreview({
  entityId,
  name,
  color,
}: ColorBadgePreviewSource) {
  const [previewName, setPreviewName] = useState(name);
  const [previewColor, setPreviewColor] = useState<string | null>(
    color || null
  );

  // Resync during render when the loaded record or color changes, using the
  // "store previous value in state" pattern rather than an effect. See
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [syncedFrom, setSyncedFrom] = useState({ entityId, color });
  if (syncedFrom.entityId !== entityId || syncedFrom.color !== color) {
    setSyncedFrom({ entityId, color });
    setPreviewColor(color || null);
    if (syncedFrom.entityId !== entityId) {
      setPreviewName(name);
    }
  }

  return { previewName, setPreviewName, previewColor, setPreviewColor };
}
