/**
 * Watches the layout chrome above an element inside the app's scroll container.
 *
 * Chrome above a pane changes height without the viewport changing size: an
 * account banner mounts, its line of text wraps as the container narrows, or
 * its inline button swaps to a longer label mid-submit. The element below is
 * moved, not resized, so a `ResizeObserver` on the element itself never fires
 * and neither does a window `resize`. Anything positioned from where that
 * element sits has to watch the chrome instead.
 *
 * @see {@link file://../hooks/use-fill-viewport-height.ts}
 * @see {@link file://../components/scanner/drawer/base-drawer.tsx}
 */

/**
 * Calls `onChange` whenever chrome above `element` in its scroll container
 * (`<main>`, else the document root) resizes, mounts or unmounts, and when the
 * container itself resizes.
 *
 * "Above" means every earlier sibling along the path from `element` up to the
 * container, so a page header that shares a route wrapper with the element is
 * watched as well as chrome directly inside the container. The element and its
 * ancestors are never observed: a caller that writes the element's own height
 * must not have that write fed back in as a resize, and chrome below the
 * element cannot move its top.
 *
 * @param element - The element whose position the caller depends on
 * @param onChange - Runs on every change; the caller re-measures there
 * @returns A cleanup function that disconnects every observer
 */
export function observeChromeAbove(
  element: HTMLElement,
  onChange: () => void
): () => void {
  const container = element.closest("main") ?? document.documentElement;
  const observer = new ResizeObserver(() => onChange());

  // The element's ancestors up to and including the container. Chrome lives
  // among their earlier siblings, and mounts by changing their child lists.
  const path: Element[] = [];
  for (
    let node = element.parentElement;
    node && container.contains(node);
    node = node.parentElement
  ) {
    path.push(node);
    if (node === container) break;
  }

  // The container is `h-dvh`, so chrome that grows taller overflows it
  // instead of resizing it: each piece of chrome has to be watched itself.
  // The container still matters for viewport and sidebar-width changes.
  const subscribe = () => {
    observer.disconnect();
    observer.observe(container);

    for (
      let node: Element | null = element;
      node && node !== container;
      node = node.parentElement
    ) {
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        observer.observe(sibling);
      }
    }
  };

  subscribe();

  // A banner mounting or unmounting moves the element without resizing
  // anything already watched, and changes which elements are worth watching.
  const chromeListObserver = new MutationObserver(() => {
    subscribe();
    onChange();
  });
  for (const node of path) {
    chromeListObserver.observe(node, { childList: true });
  }

  return () => {
    observer.disconnect();
    chromeListObserver.disconnect();
  };
}
