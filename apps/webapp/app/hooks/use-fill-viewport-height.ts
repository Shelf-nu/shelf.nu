/**
 * Sizing for a full-bleed surface that must reach the bottom of the screen.
 *
 * Some routes render one tall, non-scrolling pane — the code scanner's
 * viewfinder, for example — inside the app's scroll container. That pane needs
 * an explicit pixel height, because nothing in its own content tells it how
 * tall the screen is.
 *
 * The height is derived from where the pane actually sits, never from a
 * constant standing in for the chrome above it. Chrome above the pane varies by
 * breakpoint and by account state — the layout's mobile top bar only exists
 * below `md`, and banners appear for an unpaid invoice or a missing payment
 * method — so any hardcoded figure is right for one arrangement and silently
 * wrong for the rest, leaving either a strip of dead space under the pane or a
 * page that scrolls when it should not.
 *
 * @see {@link file://./use-viewport-height.ts}
 */
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useViewportHeight } from "./use-viewport-height";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The measurement has to land before paint or the pane shows one frame at the
 * wrong height, but `useLayoutEffect` has nothing to do during SSR and warns
 * when called there.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Inputs to {@link resolveFillHeight}. */
export type ResolveFillHeightArgs = {
  /** Visible height of the scroll container the pane lives in. */
  containerHeight: number;
  /** The pane's distance from the top of that container's content. */
  elementOffsetTop: number;
  /** Smallest height worth rendering, so a mismeasurement can't collapse it. */
  minHeight?: number;
};

/**
 * Resolves the height that makes a pane end exactly at its container's bottom.
 *
 * @param args - Container and pane measurements; see {@link ResolveFillHeightArgs}.
 * @returns A height in pixels, never below `minHeight`.
 */
export function resolveFillHeight({
  containerHeight,
  elementOffsetTop,
  minHeight = 0,
}: ResolveFillHeightArgs): number {
  return Math.max(containerHeight - elementOffsetTop, minHeight);
}

/**
 * Measures a pane's offset and returns the height that fills the rest of the
 * screen below it.
 *
 * Recomputes whenever the viewport changes size, which covers rotation, window
 * resizing and the mobile browser's collapsing address bar.
 *
 * @param options.minHeight - Floor for the resolved height.
 * @returns A `ref` to attach to the pane, and its `height` — `undefined` until
 * the first measurement, which lets the pane size itself naturally for that one
 * render rather than flashing at a guessed height.
 */
export function useFillViewportHeight<T extends HTMLElement>({
  minHeight = 0,
}: { minHeight?: number } = {}): {
  ref: RefObject<T | null>;
  height: number | undefined;
} {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const { vh, isMd } = useViewportHeight();

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    // The scroll container, not the window: it is the box the pane has to end
    // flush with, and the one whose height already excludes the app chrome.
    const container = element.closest("main") ?? document.documentElement;

    const measure = () => {
      // Offset within the container's CONTENT, so a scrolled container reports
      // the same number as an unscrolled one. Reading the viewport-relative top
      // alone would shrink the pane every time the page scrolled.
      const elementOffsetTop =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;

      const next = resolveFillHeight({
        containerHeight: container.clientHeight,
        elementOffsetTop,
        minHeight,
      });

      // Same height means nothing above the pane moved. Bailing out keeps an
      // observer callback from scheduling a render that changes nothing.
      setHeight((current) => (current === next ? current : next));
    };

    measure();

    // Chrome above the pane changes height without the viewport ever changing
    // size: an account banner's one line of text wraps to two as the container
    // narrows, and its inline button swaps to a longer label mid-submit.
    // `useViewportHeight` writes the same `vh` and the same `isMd` through all
    // of that, so React bails out and no dependency here changes.
    const observer = new ResizeObserver(measure);

    // Watching the container alone is not enough. It is `h-dvh`, so chrome that
    // grows taller overflows it instead of resizing it, and the observer stays
    // silent — the chrome itself has to be watched. The container still earns
    // its place for viewport and sidebar-width changes.
    //
    // Observation stops at the pane. This effect writes the pane's height, so
    // watching the pane — or any ancestor of it — would feed that write back in
    // as a resize; and chrome below the pane cannot move its top anyway.
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

    // A banner mounting or unmounting adds or removes chrome above the pane
    // without resizing anything already being watched, and changes which
    // elements are worth watching.
    const chromeListObserver = new MutationObserver(() => {
      subscribe();
      measure();
    });
    chromeListObserver.observe(container, { childList: true });

    return () => {
      observer.disconnect();
      chromeListObserver.disconnect();
    };
    // `vh`/`isMd` are not read here — they are the signal that the viewport
    // changed and the offset is worth measuring again.
  }, [vh, isMd, minHeight]);

  return { ref, height };
}
