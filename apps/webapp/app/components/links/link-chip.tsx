/**
 * The chip a custom field value gets when the whole value is one web link:
 * a kind icon, a name (title, file name or kind) and where it lives
 * ("PDF", "SharePoint").
 *
 * @see {@link file://./text-with-links.tsx} which decides chip or linked text
 * @see {@link file://../../../../../packages/links/src/chip-text.ts} for the words
 */
import { linkChipText, type LinkTitle, type ParsedLink } from "@shelf/links";
import { buildCustomFieldLinkHref } from "~/utils/custom-field-link";
import { tw } from "~/utils/tw";
import { LinkIcon } from "./link-icon";

/**
 * A link chip that opens the link in a new tab.
 *
 * @param props.link - The parsed value
 * @param props.title - What the workspace knows about this link (fetched
 *   page title, a name someone gave it), if anything
 * @param props.compact - Smaller text and a capped width, for table cells
 */
export function LinkChip({
  link,
  title,
  compact = false,
}: {
  link: ParsedLink;
  title?: LinkTitle;
  compact?: boolean;
}) {
  const { primary, meta, label } = linkChipText(link, title);
  return (
    <a
      href={buildCustomFieldLinkHref(link.url)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={link.url}
      className={tw(
        "link-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-2 py-0.5 align-middle text-gray-700",
        "hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        compact ? "max-w-[260px] text-xs" : "text-sm"
      )}
    >
      <LinkIcon icon={link.icon} className="text-gray-500" />
      <span className="truncate font-medium">{primary}</span>
      {meta ? (
        <span className="max-w-[24ch] shrink-0 truncate font-normal text-gray-500">
          {meta}
        </span>
      ) : null}
    </a>
  );
}
