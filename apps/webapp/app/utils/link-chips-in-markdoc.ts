/**
 * Turns bare web links in rendered note Markdown into link chips.
 *
 * Runs on the tree `Markdoc.transform` produced (after `sanitizeMarkdocTree`),
 * so it sees text exactly as it will render. Every http(s) URL `segmentText`
 * finds in a text run becomes a `LinkChipComponent` tag; the text around it is
 * kept. Links someone wrote as Markdown (`a` tags), code, and Shelf's own
 * components (tags whose name starts with a capital) are left alone.
 *
 * @see {@link file://../components/markdown/link-chip-component.tsx}
 */
import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";
import { segmentText } from "@shelf/links";

/** Tags whose text is never turned into chips. */
const OPAQUE_TAGS = new Set(["a", "code", "pre"]);

function chipText(text: string): RenderableTreeNode[] {
  const segments = segmentText(text);
  if (!segments.some((segment) => segment.type === "link")) return [text];
  return segments.map((segment) =>
    segment.type === "link"
      ? new Markdoc.Tag("LinkChipComponent", { url: segment.url }, [])
      : segment.text
  );
}

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
  const [node] = chipNode(tree as RenderableTreeNode);
  return node;
}
