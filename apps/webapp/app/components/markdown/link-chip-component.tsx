/**
 * Renders a web link found in a comment as a link chip.
 *
 * `MarkdownViewer` with `linkChips` and `allowExternalLinks` turns each bare
 * http(s) URL in a comment into a `LinkChipComponent` tag; this is the
 * component behind that tag. Only a
 * value `parseLink` accepts becomes a chip, so the anchor is always http(s).
 *
 * @see {@link file://../../utils/link-chips-in-markdoc.ts}
 */
import { parseLink } from "@shelf/links";
import { LinkChip } from "~/components/links/link-chip";
import { useLinkTitles } from "~/components/links/link-titles-context";

/**
 * A link chip for one URL in a comment, with its page title when the page
 * provides `LinkTitles`.
 *
 * @param props.url - The URL as written in the comment
 */
export function LinkChipComponent({ url }: { url: string }) {
  const titles = useLinkTitles();
  const link = parseLink(url);
  if (!link) return <>{url}</>;
  return <LinkChip link={link} title={titles?.[link.key]} />;
}
