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
 * Height of the scanner-mode code-entry panel (`ScannerMode` in
 * `code-scanner.tsx`): its top padding, the labelled input and the one-line
 * hint. Change it together with that markup, or the drawer either covers the
 * input or wastes height the scanned rows need.
 */
export const SCANNER_INPUT_PANEL_HEIGHT = 88;

/**
 * Space kept above the drawer in scanner mode: the page chrome plus the
 * code-entry panel, and nothing more. Scanner mode is a barcode gun or typed
 * code, so there is no viewfinder to keep in view, and every pixel reserved
 * beyond the input comes out of the scanned-rows list.
 */
export const SCANNER_INPUT_GAP = DRAWER_TOP_GAP + SCANNER_INPUT_PANEL_HEIGHT;

/** Space between the bottom of the measured code-entry panel and the drawer. */
export const SCANNER_DRAWER_SPACING = 8;

/**
 * Floor for the resolved height: enough for the drag handle and one line of
 * title, so the drawer is always recognisable and re-openable.
 *
 * It yields to a viewport shorter than itself. Holding the floor there would
 * push the drawer past the top of the screen and strand the handle — the one
 * outcome the floor exists to prevent.
 */
export const MIN_DRAWER_HEIGHT = 148;

/** Inputs to {@link resolveDrawerHeight}. */
export type ResolveDrawerHeightArgs = {
  /** Whether the user has pulled the drawer open. */
  expanded: boolean;
  /** Whether scanner (code-entry) mode is active; the input panel needs room. */
  isScannerMode: boolean;
  /**
   * Viewport-relative bottom of the code-entry panel (`data-scanner-input-panel`),
   * or `null` before it has been measured. Pages place the input at different
   * heights, so the drawer follows the real panel; {@link SCANNER_INPUT_GAP} is
   * only the fallback for the first frame.
   */
  scannerInputBottom?: number | null;
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
  scannerInputBottom = null,
  viewportHeight,
  chromeHeight,
  footerHeight,
  hasBody,
  collapsedHeight,
}: ResolveDrawerHeightArgs): number {
  // Chrome that cannot give up height: the handle and title line the floor
  // stands for, plus the pinned footer. The custom header is deliberately
  // excluded — it shrinks and scrolls, so it is not owed room here, and
  // counting it would make an expanded drawer grow to hold a header that was
  // always going to yield.
  //
  // An expanded drawer is never smaller than this. In scanner mode the gap
  // reserved for the input panel is a preference, not a guarantee: a visible
  // input is worth less than a reachable action, and the footer is `shrink-0`
  // precisely so the drawer's action never sits behind a scrollbar of its own.
  const unshrinkableChrome = MIN_DRAWER_HEIGHT + footerHeight;

  const natural = expanded
    ? Math.max(
        viewportHeight -
          (isScannerMode
            ? scannerInputBottom === null
              ? SCANNER_INPUT_GAP
              : scannerInputBottom + SCANNER_DRAWER_SPACING
            : DRAWER_TOP_GAP),
        unshrinkableChrome
      )
    : chromeHeight ??
      (hasBody ? collapsedHeight : MIN_DRAWER_HEIGHT) + footerHeight;

  // Before the first measurement there is no viewport to clamp against, and
  // clamping against 0 would render the drawer as a sliver on first paint.
  if (viewportHeight <= 0) {
    return natural;
  }

  const floor = Math.min(MIN_DRAWER_HEIGHT, viewportHeight);
  const ceiling = Math.max(viewportHeight - DRAWER_TOP_GAP, floor);

  return Math.min(Math.max(natural, floor), ceiling);
}
