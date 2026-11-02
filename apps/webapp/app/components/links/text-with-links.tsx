/**
 * How a TEXT custom field value is displayed: a chip when the whole value is
 * one web link, otherwise the text with each URL in it linked.
 *
 * @see {@link file://./link-chip.tsx}
 * @see {@link file://./linked-text.tsx}
 * @see {@link file://./rename-link-popover.tsx}
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://../assets/assets-index/advanced-asset-columns.tsx}
 */
import { parseLink, type LinkTitles } from "@shelf/links";
import { LinkChip } from "./link-chip";
import { LinkedText } from "./linked-text";
import { RenameLinkPopover } from "./rename-link-popover";

/**
 * Displays a TEXT custom field value with its links working.
 *
 * @param props.value - The stored value (`raw`)
 * @param props.titles - Titles known for links in this workspace, keyed by
 *   `ParsedLink.key`; a link without an entry shows its parsed words
 * @param props.compact - Chip sized for a table cell
 * @param props.canRename - Offer "Name this link" beside a chip; only for
 *   people who may edit assets
 */
export function TextWithLinks({
  value,
  titles,
  compact,
  canRename = false,
}: {
  value: string;
  titles?: LinkTitles;
  compact?: boolean;
  canRename?: boolean;
}) {
  const link = parseLink(value);
  if (!link) return <LinkedText text={value} />;

  const title = titles?.[link.key];
  const chip = <LinkChip link={link} title={title} compact={compact} />;
  if (!canRename) return chip;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {chip}
      <RenameLinkPopover value={value} link={link} title={title} />
    </span>
  );
}
