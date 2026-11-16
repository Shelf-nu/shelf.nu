/**
 * Turns bare web links in rendered comment Markdown into link chips, and
 * names the links a note shows as chips.
 *
 * `chipBareUrls` runs on the tree `Markdoc.transform` produced (after
 * `sanitizeMarkdocTree`), so it sees text exactly as it will render. Every
 * http(s) URL `segmentText` finds in a text run becomes a `LinkChipComponent`
 * tag; the text around it is kept. Links someone wrote as Markdown (`a` tags),
 * code, and Shelf's own components (tags whose name starts with a capital,
 * such as `NameComponent`) are left alone.
 *
 * `chipUrlsInNote` lists the URLs a note renders as chips, which are the only
 * ones whose page titles are read and fetched.
 *
 * @see {@link file://../components/markdown/link-chip-component.tsx}
 * @see {@link file://../components/markdown/name-component.tsx}
 */
import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";
import { segmentText } from "@shelf/links";
import { encodeRawTagAttributeValues } from "./markdoc-tag-strings";
import { markdocConfig } from "./markdoc.config";
import { parseMarkdownToReact } from "./md";
import { sanitizeMarkdocTree } from "./sanitize-markdoc-tree";

/** Tags whose text is never turned into chips. */
const OPAQUE_TAGS = new Set(["a", "code", "pre"]);

/** Splits one text run into its text and a `LinkChipComponent` per link. */
function chipText(text: string): RenderableTreeNode[] {
  const segments = segmentText(text);
  if (!segments.some((segment) => segment.type === "link")) return [text];
  return segments.map((segment) =>
    segment.type === "link"
      ? new Markdoc.Tag("LinkChipComponent", { url: segment.url }, [])
      : segment.text
  );
}

/**
 * Chips the links in one node and its children, skipping opaque tags (links,
 * code) and Shelf's components, whose text is never a chip.
 */
function chipNode(node: RenderableTreeNode): RenderableTreeNode[] {
  if (typeof node === "string") return chipText(node);
  if (!Markdoc.Tag.isTag(node)) return [node];
  if (OPAQUE_TAGS.has(node.name) || /^[A-Z]/.test(node.name)) return [node];
  node.children = node.children.flatMap(chipNode);
  return [node];
}

/**
 * Replaces bare http(s) URLs in a rendered note with link chip tags, in place.
 *
 * @param tree - A tree from `Markdoc.transform`; it is modified
 * @returns The same tree
 */
export function chipBareUrls(tree: RenderableTreeNodes): RenderableTreeNodes {
  if (Array.isArray(tree)) return tree.flatMap(chipNode);
  // A string root can split into several nodes; a tag root stays one.
  const nodes = chipNode(tree as RenderableTreeNode);
  return nodes.length === 1 ? nodes[0] : nodes;
}

/** The URLs of the chips in a rendered tree, in reading order. */
function chipUrlsOf(tree: RenderableTreeNodes): string[] {
  const urls: string[] = [];
  const walk = (node: RenderableTreeNodes): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!Markdoc.Tag.isTag(node)) return;
    if (node.name === "LinkChipComponent") {
      urls.push(String(node.attributes.url));
    } else if (node.name === "NameComponent" && node.attributes.chips) {
      for (const segment of segmentText(String(node.attributes.text ?? ""))) {
        if (segment.type === "link") urls.push(segment.url);
      }
    }
    node.children.forEach(walk);
  };
  walk(tree);
  return urls;
}

/**
 * The web links a note shows as link chips, in reading order.
 *
 * Renders the note the way the activity feed does: a comment gets chips for
 * its bare URLs (not for Markdown links, code or tag attributes); a system
 * note only for the values its writer marked with the `name` tag's `chips`.
 *
 * @param note - The note's type and stored Markdoc source
 * @returns The URLs, as written in the note
 */
export function chipUrlsInNote(note: {
  type: "COMMENT" | "UPDATE";
  content: string;
}): string[] {
  if (note.type === "COMMENT") {
    const tree = parseMarkdownToReact(note.content, markdocConfig);
    return chipUrlsOf(
      chipBareUrls(sanitizeMarkdocTree(tree, { allowExternalLinks: true }))
    );
  }
  const tree = parseMarkdownToReact(
    encodeRawTagAttributeValues(note.content),
    markdocConfig
  );
  return chipUrlsOf(sanitizeMarkdocTree(tree));
}
