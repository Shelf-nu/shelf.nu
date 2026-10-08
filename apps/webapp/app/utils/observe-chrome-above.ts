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
 * Observation stops at the container child that holds `element`: chrome below
 * cannot move its top, and a caller that writes the element's own height must
 * not have that write fed back in as a resize.
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

  // The container is `h-dvh`, so chrome that grows taller overflows it
  // instead of resizing it: each piece of chrome has to be watched itself.
  // The container still matters for viewport and sidebar-width changes.
  const subscribe = () => {
    observer.disconnect();
    observer.observe(container);

    for (const child of Array.from(container.children)) {
      if (child.contains(element)) {
        break;
      }
      observer.observe(child);
    }
  };

  subscribe();

  // A banner mounting or unmounting moves the element without resizing
  // anything already watched, and changes which elements are worth watching.
  const chromeListObserver = new MutationObserver(() => {
    subscribe();
    onChange();
  });
  chromeListObserver.observe(container, { childList: true });

  return () => {
    observer.disconnect();
    chromeListObserver.disconnect();
  };
}
