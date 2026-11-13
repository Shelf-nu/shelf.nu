/**
 * Viewport-size hooks shared by the app shell.
 *
 * The breakpoints mirror Tailwind's `md` (768px) and `xl` (1280px) screens so
 * JavaScript decisions line up with the CSS that styles the same layout.
 *
 * @see {@link file://./../components/layout/sidebar/sidebar.tsx}
 */
import { useEffect, useState } from "react";

/** Below this width the sidebar is an off-canvas sheet (Tailwind `md`). */
const MOBILE_BREAKPOINT = 768;

/**
 * Below this width a desktop-layout window is too narrow to show the expanded
 * sidebar next to the page content (Tailwind `xl`).
 */
export const COMPACT_BREAKPOINT = 1280;

/**
 * Tracks whether a CSS media query matches, updating on change.
 *
 * Returns `false` during SSR and the first client render, so server and client
 * markup agree; the real value lands right after hydration.
 *
 * @param query - A media query string, e.g. `(max-width: 767px)`
 * @returns Whether the query currently matches
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);

    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Whether the viewport is phone-sized (narrower than Tailwind `md`).
 *
 * @returns `true` below 768px
 */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * Whether the viewport uses the desktop layout but is too narrow for the
 * expanded sidebar: a small laptop, a split screen, or an installed app in a
 * non-maximised window.
 *
 * @returns `true` from 768px up to 1279px
 */
export function useIsCompactViewport() {
  return useMediaQuery(
    `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${
      COMPACT_BREAKPOINT - 1
    }px)`
  );
}
