/**
 * Turns bare http(s) URLs in a parsed Markdoc document into links, using the
 * same detector as TEXT custom field values (`segmentText` from
 * `@shelf/links`), so a URL is linked the same way in both field types.
 *
 * Used only for MULTILINE_TEXT custom field values. Notes, descriptions and
 * other Markdown keep Markdoc's defaults, where a bare URL stays text. The
 * rendered tree still goes through `sanitizeMarkdocTree` in `MarkdownViewer`.
 *
 * @see {@link file://./custom-fields.ts} `getCustomFieldDisplayValue`
 * @see {@link file://./sanitize-markdoc-tree.ts}
 */
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { segmentText } from "@shelf/links";
import { buildCustomFieldLinkHref } from "./custom-field-link";

/** Nodes whose text is never linked: authored links and code. */
const OPAQUE_NODES = new Set(["link", "code", "fence", "image"]);

function linkTextNode(node: Node): Node[] {
  const segments = segmentText(String(node.attributes.content ?? ""));
  if (!segments.some((segment) => segment.type === "link")) return [node];

  return segments.map((segment) => {
    const text = new Markdoc.Ast.Node("text", { content: segment.text });
    text.inline = node.inline;
    if (segment.type === "text") return text;

    const link = new Markdoc.Ast.Node(
      "link",
      { href: buildCustomFieldLinkHref(segment.url) },
      [text]
    );
    link.inline = node.inline;
    return link;
  });
}

/**
 * Replaces every bare URL in the document's text with a link node, in place.
 * Text inside authored links, inline code and code blocks is left alone.
 *
 * @param node - A tree from `Markdoc.parse`; it is modified
 * @returns The same node, for chaining into `Markdoc.transform`
 */
export function linkifyBareUrls(node: Node): Node {
  if (OPAQUE_NODES.has(node.type)) return node;
  node.children = node.children.flatMap((child) =>
    child.type === "text" ? linkTextNode(child) : [linkifyBareUrls(child)]
  );
  return node;
}
