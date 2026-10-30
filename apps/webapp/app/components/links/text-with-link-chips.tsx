/**
 * Free text (an asset description) with every web link in it shown as a link
 * chip, the same chip activity notes and custom fields use. The text around
 * the links is kept as written; the caller keeps its own white-space styling.
 *
 * @see {@link file://./link-chip.tsx}
 */
import { parseLink, type LinkTitles } from "@shelf/links";
import { LinkChip } from "./link-chip";
import { textRuns } from "./text-runs";

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
      {textRuns(text).map(({ start, segment }) => {
        const link = segment.type === "link" ? parseLink(segment.url) : null;
        if (!link) return <span key={start}>{segment.text}</span>;
        return <LinkChip key={start} link={link} title={titles?.[link.key]} />;
      })}
    </>
  );
}
