/**
 * Height resolution for the scanner drawer.
 *
 * {@link BaseDrawer} is `position: fixed` and animates between its collapsed
 * and expanded sizes, so its height has to be an explicit pixel value rather
 * than something the content decides. Keeping that arithmetic here — away from
 * refs, observers and render order — is what makes it checkable.
 *
 * The one invariant worth stating: **a drawer is never taller than the screen
 * it sits on.** It is anchored to the bottom edge, so surplus height goes off
 * the TOP of the viewport, taking the drag handle with it. A drawer in that
 * state cannot be collapsed, cannot be scrolled back into view, and hides its
 * own submit button — the page is simply stuck. Chrome measured from rendered
 * content (a header listing one row per reserved model, say) has no natural
 * ceiling, which is why the clamp lives here and not at any single call site.
 *
 * @see {@link file://./base-drawer.tsx}
 */

/**
 * Space kept between the top of an expanded drawer and the top of the window,
 * so the page header and breadcrumbs stay visible and clickable behind it.
 */
export const DRAWER_TOP_GAP = 80 + 53 + 8 + 16;

/**
 * Space kept above the drawer while the scanner is running, sized so the
 * camera viewfinder and its framing guides stay visible above the drawer.
 */
export const SCANNER_VIEWFINDER_GAP = 400;

/**
 * Floor for the resolved height: enough for the drag handle and one line of
 * title, so the drawer is always recognisable and re-openable.
 */
export const MIN_DRAWER_HEIGHT = 148;

/** Inputs to {@link resolveDrawerHeight}. */
export type ResolveDrawerHeightArgs = {
  /** Whether the user has pulled the drawer open. */
  expanded: boolean;
  /** Whether the live scanner is the active mode (the viewfinder needs room). */
  isScannerMode: boolean;
  /** `window.innerHeight`, or `0` before the browser has reported one. */
  viewportHeight: number;
  /**
   * Measured height of the drawer's fixed chrome — handle, custom header
   * content, title bar and pinned footer — or `null` for drawers that carry no
   * custom header content and size their collapsed state from a constant.
   */
  chromeHeight: number | null;
  /**
   * Measured height of the pinned footer. Added to the constant-based
   * collapsed sizes so pinning the action costs the drawer height rather than
   * eating the list preview the constant was chosen to show. Already included
   * in `chromeHeight` when that is measured.
   */
  footerHeight: number;
  /** Whether the drawer has body content to preview while collapsed. */
  hasBody: boolean;
  /** Collapsed height for drawers without custom chrome to measure. */
  collapsedHeight: number;
};

/**
 * Resolves the drawer's pixel height for the current state.
 *
 * @param args - Drawer state and measurements; see {@link ResolveDrawerHeightArgs}.
 * @returns A height in pixels, never taller than the viewport allows.
 */
export function resolveDrawerHeight({
  expanded,
  isScannerMode,
  viewportHeight,
  chromeHeight,
  footerHeight,
  hasBody,
  collapsedHeight,
}: ResolveDrawerHeightArgs): number {
  const natural = expanded
    ? viewportHeight - (isScannerMode ? SCANNER_VIEWFINDER_GAP : DRAWER_TOP_GAP)
    : chromeHeight ??
      (hasBody ? collapsedHeight : MIN_DRAWER_HEIGHT) + footerHeight;

  // Before the first measurement there is no viewport to clamp against, and
  // clamping against 0 would render the drawer as a sliver on first paint.
  if (viewportHeight <= 0) {
    return natural;
  }

  const ceiling = Math.max(viewportHeight - DRAWER_TOP_GAP, MIN_DRAWER_HEIGHT);

  return Math.min(Math.max(natural, MIN_DRAWER_HEIGHT), ceiling);
}
