/**
 * SystemNoteViewer
 *
 * The renderer for system-generated (UPDATE) activity notes. Those notes are
 * Markdoc source assembled by the wrappers in `~/utils/markdoc-wrappers`,
 * which store user text inside tag attributes raw, line breaks and backslashes
 * included. Markdoc cannot parse that as is, so this viewer encodes the raw
 * attribute values first and then renders through `MarkdownViewer` with its
 * restrictive default link handling.
 *
 * Author-written content (comments, announcements, condition notes) must use
 * `MarkdownViewer` directly, so it shows exactly as typed, Markdoc examples in
 * code spans included.
 *
 * @see {@link file://./markdown-viewer.tsx}
 * @see {@link file://./../../utils/markdoc-tag-strings.ts}
 */
import { useMemo } from "react";
import { encodeRawTagAttributeValues } from "~/utils/markdoc-tag-strings";
import { MarkdownViewer } from "./markdown-viewer";

/** Props for {@link SystemNoteViewer}. */
type SystemNoteViewerProps = {
  /** The stored Markdoc source of a system-generated note. */
  content: string;
  /** Extra classes for the viewer's wrapper. */
  className?: string;
  /** Render audit image previews inline instead of in a portal. */
  disablePortal?: boolean;
};

/**
 * Renders a system-generated note, encoding the raw tag attribute values its
 * writers store so every tag parses. External links stay blocked.
 *
 * @param props - See {@link SystemNoteViewerProps}
 * @returns The rendered note
 */
export function SystemNoteViewer({
  content,
  className,
  disablePortal,
}: SystemNoteViewerProps) {
  const encoded = useMemo(
    () => encodeRawTagAttributeValues(content),
    [content]
  );

  return (
    <MarkdownViewer
      content={encoded}
      className={className}
      disablePortal={disablePortal}
    />
  );
}
