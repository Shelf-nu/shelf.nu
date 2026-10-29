/**
 * How a TEXT custom field value is displayed: a chip when the whole value is
 * one web link, otherwise the text with each URL in it linked.
 *
 * @see {@link file://./link-chip.tsx}
 * @see {@link file://./linked-text.tsx}
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://../assets/assets-index/advanced-asset-columns.tsx}
 */
import { parseLink, type LinkTitles } from "@shelf/links";
import { LinkChip } from "./link-chip";
import { LinkedText } from "./linked-text";

/**
 * Displays a TEXT custom field value with its links working.
 *
 * @param props.value - The stored value (`raw`)
 * @param props.titles - Titles known for links in this workspace, keyed by
 *   `ParsedLink.key`; a link without an entry shows its parsed words
 * @param props.compact - Chip sized for a table cell
 */
export function TextWithLinks({
  value,
  titles,
  compact,
}: {
  value: string;
  titles?: LinkTitles;
  compact?: boolean;
}) {
  const link = parseLink(value);
  if (link) {
    return (
      <LinkChip link={link} title={titles?.[link.key]} compact={compact} />
    );
  }
  return <LinkedText text={value} />;
}
