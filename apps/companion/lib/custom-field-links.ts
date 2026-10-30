/**
 * How custom field values with web links read on the asset screen.
 *
 * Every rule about the URL itself (detection, provider, kind, chip words)
 * comes from `@shelf/links`, the same package the web app reads links with.
 * This module only applies it to what the mobile asset detail payload
 * carries: a value that is exactly one link becomes a chip, titled from
 * `asset.fieldLinkTitles` (by custom field id) when the server knows one.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../components/asset-detail/custom-fields-section.tsx}
 * @see {@link file://../components/links/text-with-links.tsx}
 * @see {@link file://./custom-field-links.test.ts}
 */

import {
  linkChipText,
  parseLink,
  segmentText,
  type ChipText,
  type FieldLinkTitles,
  type LinkIconId,
  type LinkTitle,
} from "@shelf/links";

/** Everything a link chip draws: its words, its icon and the URL it opens. */
export type LinkChipModel = ChipText & {
  readonly url: string;
  readonly icon: LinkIconId;
};

/**
 * The chip for a value that is exactly one http(s) link.
 *
 * Without a title the chip reads what the URL alone says ("PDF",
 * "SharePoint").
 *
 * @param value - The stored text value.
 * @param title - The value's entry in `asset.fieldLinkTitles` (looked up by
 *   the custom field's id), if any.
 * @returns The chip, or null when the value is not exactly one link.
 */
export function linkChip(
  value: string,
  title: LinkTitle | undefined
): LinkChipModel | null {
  const link = parseLink(value);
  if (!link) return null;
  return {
    ...linkChipText(link, title),
    url: link.url,
    icon: link.icon,
  };
}

/**
 * Whether a text value has at least one http(s) URL in it, so its row needs
 * room for a chip or tappable links.
 *
 * @param value - The stored text value.
 * @returns True when the value holds a link anywhere.
 */
export function containsLink(value: string): boolean {
  return segmentText(value).some((segment) => segment.type === "link");
}

/**
 * How one custom field row shows its links on the asset screen.
 * - `chips`: a TEXT value, drawn by `TextWithLinks` with the field's title.
 * - `linked-text`: a MULTILINE_TEXT value, whose URLs are tappable in place.
 */
export type CustomFieldLinkDisplay =
  | { readonly kind: "chips"; readonly title: LinkTitle | undefined }
  | { readonly kind: "linked-text" };

/**
 * Decides whether a custom field row shows links, and which title its chip
 * reads. The title comes from `asset.fieldLinkTitles`, keyed by the custom
 * field's id (the server keys it so the app never computes link keys).
 *
 * @param field.type - The custom field's type
 * @param field.id - The custom field's id (not the value row's id)
 * @param value - The value as the row displays it
 * @param fieldLinkTitles - `asset.fieldLinkTitles` from the asset payload
 * @returns How to draw the row's links, or null for a plain row
 */
export function customFieldLinkDisplay(
  field: { readonly type: string; readonly id: string },
  value: string,
  fieldLinkTitles: FieldLinkTitles | undefined
): CustomFieldLinkDisplay | null {
  if (field.type !== "TEXT" && field.type !== "MULTILINE_TEXT") return null;
  if (!containsLink(value)) return null;
  return field.type === "TEXT"
    ? { kind: "chips", title: fieldLinkTitles?.[field.id] }
    : { kind: "linked-text" };
}
