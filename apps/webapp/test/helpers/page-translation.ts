/**
 * Simulates Chrome's built-in page translation for component tests.
 *
 * Chrome replaces every text node it translates with a
 * `<font style="vertical-align: inherit;"><font …>translated</font></font>`
 * wrapper and detaches the original node. React keeps pointing at the
 * detached original, so any later commit that removes, anchors on, or updates
 * that text node misses what the reader sees. These helpers reproduce that
 * rewrite so a test can render, translate, re-render, and assert on what is
 * left in the DOM.
 *
 * @see {@link file://./../../app/utils/dom-mutation-guard.ts}
 */

/** Prefix the simulated translation adds, so translated text is recognisable. */
export const TRANSLATED_PREFIX = "[es] ";

/**
 * Replaces every non-blank text node under `root` with Chrome's `<font>`
 * wrapper holding a "translated" copy. Returns how many nodes were rewritten.
 */
export function translateTextNodes(root: Node = document.body): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue?.trim() && node.parentElement?.tagName !== "FONT") {
      textNodes.push(node);
    }
  }

  for (const text of textNodes) {
    const outer = document.createElement("font");
    outer.style.verticalAlign = "inherit";
    const inner = document.createElement("font");
    inner.style.verticalAlign = "inherit";
    inner.textContent = `${TRANSLATED_PREFIX}${text.nodeValue}`;
    outer.appendChild(inner);
    text.parentNode!.replaceChild(outer, text);
  }

  return textNodes.length;
}
