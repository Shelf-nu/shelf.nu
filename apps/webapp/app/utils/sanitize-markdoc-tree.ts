/**
 * Render-time sanitization of the Markdoc tree used for note content.
 *
 * Markdoc renders ordinary Markdown link and image syntax into NATIVE `a` /
 * `img` nodes, which never pass through our custom tag components. So
 * `[Verify your account](https://evil.example)` in a booking name reaches the
 * DOM as a working anchor, and `![](https://evil.example/px.png)` fires an
 * off-origin request the moment the feed loads. Neither syntax contains a
 * Markdoc delimiter, so write-time `stripMarkdocDelimiters` does nothing for
 * them — this module is the control that actually holds.
 *
 * It runs on the final renderable tree, so it covers both content parsed from
 * a string AND pre-parsed `RenderableTreeNodes` handed to `MarkdownViewer`,
 * and it protects notes ALREADY stored in the database.
 *
 * @see {@link file://./../components/markdown/markdown-viewer.tsx} the caller
 * @see {@link file://./safe-internal-path.ts} the internal-path predicate
 */
import Markdoc from "@markdoc/markdoc";
import type {
  RenderableTreeNode,
  RenderableTreeNodes,
  Tag,
} from "@markdoc/markdoc";
import { isInternalPath } from "./safe-internal-path";

/**
 * Schemes an author may deliberately link to. Everything else — `javascript:`,
 * `data:`, `vbscript:`, and any exotic scheme — is dropped, in every context.
 */
const SAFE_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Whether `href` is an absolute URL on a scheme we are willing to render. */
function isSafeExternalUrl(href: unknown): href is string {
  if (typeof href !== "string") {
    return false;
  }
  try {
    return SAFE_EXTERNAL_SCHEMES.has(new URL(href).protocol);
  } catch {
    // Not an absolute URL. Internal paths are handled by `isInternalPath`;
    // anything else (bare "foo.html", "#frag") is not a link we emit.
    return false;
  }
}

export type SanitizeOptions = {
  /**
   * Allow off-origin links through.
   *
   * `false` (the default) for system-generated notes: their text is assembled
   * by us from entity names, so any external link in one was injected. `true`
   * for user-authored comments, where the editor's link dialog makes external
   * links a deliberate feature. Dangerous schemes are blocked either way.
   */
  allowExternalLinks?: boolean;
};

/** Children of a stripped node, spliced into the parent in its place. */
function unwrap(node: Tag, options: SanitizeOptions): RenderableTreeNode[] {
  return sanitizeChildren(node.children ?? [], options);
}

function sanitizeChildren(
  children: RenderableTreeNode[],
  options: SanitizeOptions
): RenderableTreeNode[] {
  return children.flatMap((child) => sanitizeNode(child, options));
}

/**
 * Sanitize one node, returning zero or more nodes to take its place.
 *
 * Returning an array (rather than mutating) lets a rejected `<a>` collapse to
 * its own children — the label survives, the destination does not.
 */
function sanitizeNode(
  node: RenderableTreeNode,
  options: SanitizeOptions
): RenderableTreeNode | RenderableTreeNode[] {
  if (!Markdoc.Tag.isTag(node)) {
    return node;
  }

  if (node.name === "img") {
    const src = node.attributes?.src;
    // Notes have no image affordance — the editor offers link and raw-block
    // dialogs only, and audit evidence has its own trusted tag. So an
    // off-origin image is either injected or a tracking pixel; keep the alt
    // text so the sentence still reads.
    if (!isInternalPath(src)) {
      const alt = node.attributes?.alt;
      return typeof alt === "string" && alt.length > 0 ? [alt] : [];
    }
  }

  if (node.name === "a") {
    const href = node.attributes?.href;
    const internal = isInternalPath(href);
    const externalOk =
      options.allowExternalLinks === true && isSafeExternalUrl(href);

    if (!internal && !externalOk) {
      return unwrap(node, options);
    }

    return new Markdoc.Tag(
      node.name,
      {
        ...node.attributes,
        // Off-origin targets get the reverse-tabnabbing guard; `window.opener`
        // would otherwise hand the opened page a handle on ours.
        ...(internal ? {} : { rel: "noopener noreferrer", target: "_blank" }),
      },
      sanitizeChildren(node.children ?? [], options)
    );
  }

  return new Markdoc.Tag(
    node.name,
    node.attributes,
    sanitizeChildren(node.children ?? [], options)
  );
}

/**
 * Strip unsafe native anchors and images from a renderable Markdoc tree.
 *
 * @param content - The tree to sanitize (any `RenderableTreeNodes` shape)
 * @param options - See {@link SanitizeOptions}
 * @returns A new tree; the input is not mutated
 */
export function sanitizeMarkdocTree(
  content: RenderableTreeNodes,
  options: SanitizeOptions = {}
): RenderableTreeNodes {
  if (Array.isArray(content)) {
    return sanitizeChildren(content as RenderableTreeNode[], options);
  }
  const result = sanitizeNode(content as RenderableTreeNode, options);
  return Array.isArray(result) ? result : result;
}
