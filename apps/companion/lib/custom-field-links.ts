/**
 * How custom field values with web links read on the asset screen.
 *
 * Every rule about the URL itself (detection, provider, kind, chip words, the
 * key a title is stored under) comes from `@shelf/links`, the same package the
 * web app reads links with. This module only applies it to what the mobile
 * asset detail payload carries: a value that is exactly one link becomes a
 * chip, titled from `asset.linkTitles` when the server knows one.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../components/links/text-with-links.tsx}
 * @see {@link file://../components/asset-detail/custom-fields-section.tsx}
 * @see {@link file://./custom-field-links.test.ts}
 */

import {
  linkChipText,
  parseLink,
  segmentText,
  type ChipText,
  type LinkIconId,
  type LinkTitles,
} from "@shelf/links";

/** Everything a link chip draws: its words, its icon and the URL it opens. */
export type LinkChipModel = ChipText & {
  readonly url: string;
  readonly icon: LinkIconId;
};

/**
 * The chip for a value that is exactly one http(s) link.
 *
 * The title is looked up by the link's key, so a stored value that differs
 * only by a `#fragment` or Shelf's own `ref` parameter still finds it. Without
 * a title the chip reads what the URL alone says ("PDF", "SharePoint").
 *
 * @param value - The stored text value.
 * @param titles - `asset.linkTitles`; absent on servers that send none.
 * @returns The chip, or null when the value is not exactly one link.
 */
export function linkChip(
  value: string,
  titles: LinkTitles | undefined
): LinkChipModel | null {
  const link = parseLink(value);
  if (!link) return null;
  return {
    ...linkChipText(link, titles?.[link.key]),
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
