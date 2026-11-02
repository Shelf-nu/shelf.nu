/**
 * Label Form Fields
 *
 * Zod field schemas shared by the category and tag forms (new and edit). Both
 * entities are coloured labels with the same name and colour rules, and the
 * same schema runs in the browser (react-zorm) and in the route action
 * (`parseData`), so a value is accepted or refused identically on both sides.
 *
 * @see {@link file://./../components/category/new-category-form.tsx}
 * @see {@link file://./../routes/_layout+/categories.$categoryId_.edit.tsx}
 * @see {@link file://./../routes/_layout+/tags.new.tsx}
 * @see {@link file://./../routes/_layout+/tags.$tagId_.edit.tsx}
 */
import { z } from "zod";

/** A stored label colour: `#` followed by six lowercase hex digits. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const HEX_COLOR_MESSAGE = "Enter a hex color, like #4f46e5";

/**
 * Brings a typed hex colour into the stored `#rrggbb` form.
 *
 * Accepts the shapes people type: surrounding whitespace, a missing `#`,
 * uppercase digits and the 3-digit shorthand (`#fff` becomes `#ffffff`).
 * Anything that is not hex is returned as-is (with a `#`), so the schema
 * still refuses it with a message.
 *
 * @param value - The colour as typed
 * @returns The normalised colour string
 */
export function normalizeHexColor(value: string): string {
  const hex = value.trim().replace(/^#/, "").toLowerCase();
  const expanded = /^[0-9a-f]{3}$/.test(hex)
    ? hex
        .split("")
        .map((digit) => digit + digit)
        .join("")
    : hex;
  return `#${expanded}`;
}

/** Label name: any non-blank text, stored trimmed. Short names like "IT" are valid. */
export const labelNameSchema = z.string().trim().min(1, "Name is required");

/** Required label colour, normalised to `#rrggbb` (categories). */
export const hexColorSchema = z
  .string()
  .transform(normalizeHexColor)
  .pipe(z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE));

/** Optional label colour: blank means no colour (`null`), otherwise `#rrggbb` (tags). */
export const optionalHexColorSchema = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? normalizeHexColor(value) : null))
  .pipe(z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE).nullable());
