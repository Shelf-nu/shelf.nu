/**
 * Free text (an asset description) with every web link in it shown as a link
 * chip, the same chip activity notes and custom fields use. The text around
 * the links is kept as written; the caller keeps its own white-space styling.
 *
 * @see {@link file://./link-chip.tsx}
 */
import { parseLink, segmentText, type LinkTitles } from "@shelf/links";
import { LinkChip } from "./link-chip";

/**
 * Renders `text` with its http(s) URLs replaced by link chips.
 *
 * @param props.text - The text to show
 * @param props.titles - Page titles and names by `LinkKey`, from the loader
 */
export function TextWithLinkChips({
  text,
  titles,
}: {
  text: string;
  titles?: LinkTitles;
}) {
  return (
    <>
      {segmentText(text).map((segment, index) => {
        const link = segment.type === "link" ? parseLink(segment.url) : null;
        // why: segments are a fixed split of one string, never reordered
        // eslint-disable-next-line react/no-array-index-key
        if (!link) return <span key={index}>{segment.text}</span>;
        return (
          // eslint-disable-next-line react/no-array-index-key
          <LinkChip key={index} link={link} title={titles?.[link.key]} />
        );
      })}
    </>
  );
}
