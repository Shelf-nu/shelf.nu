/**
 * Safe-area maths for controls that float over a screen.
 *
 * A window's safe-area insets are not symmetric and are not only at the top
 * and bottom. An iPhone Duo's inner display, open sideways or in Split View,
 * draws the status bar as a vertical rail about 84 pt wide down the left or
 * right edge, and an Android foldable's camera cutout lands on a side edge
 * when the device is turned. A button placed at a fixed `right: 20` sits
 * under either one. Every offset from a window edge therefore adds that
 * edge's own inset, never the opposite edge's.
 *
 * Screens in a navigator's content column get their side insets from
 * `components/content-column.tsx`; these helpers are for the surfaces outside
 * it (the scanners, full-window image viewers, bottom sheets in a `Modal`).
 *
 * Pure (no React Native import) so the maths runs under `node --test`.
 *
 * @see lib/use-safe-edges.ts for the hooks that feed these the live insets
 */

import { showsTabSidebar } from "./content-column";

/** Safe-area insets, in points, as `react-native-safe-area-context` gives them. */
export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * The window's insets as a screen inside the tab navigator meets them.
 *
 * The tab bar already covers part of the window and pads itself for the inset
 * there: along the bottom it takes the home-indicator inset, and as the
 * sidebar on the left it takes the left inset (a Duo's rail on that side
 * sits behind the sidebar). The screen only has to avoid what is left.
 *
 * @param window - the window's insets
 * @param windowWidth - the window's width, which decides where the tab bar is
 * @returns the insets on the screen's own edges
 */
export function tabScreenInsets(
  window: EdgeInsets,
  windowWidth: number
): EdgeInsets {
  const sidebar = showsTabSidebar(windowWidth);
  return {
    top: window.top,
    right: window.right,
    bottom: sidebar ? window.bottom : 0,
    left: sidebar ? 0 : window.left,
  };
}

/**
 * Distance from the top of a full-window overlay to its top controls (a close
 * button, a scanner header): clear of the status bar or camera cutout, and
 * never higher than `minimum`, the offset the phone layouts are drawn for.
 *
 * @param topInset - the window's top inset
 * @param minimum - the smallest offset, in points
 */
export function overlayTopOffset(topInset: number, minimum: number): number {
  // 8 pt of air under the status bar, the same gap the phone layouts leave.
  return Math.max(topInset + 8, minimum);
}

/**
 * Width and left offset of a bottom sheet held to a column of `maxWidth` in a
 * full-window overlay, centred in the space between the side insets so a rail
 * or cutout on one side never covers it.
 *
 * @param windowWidth - the window's width, in points
 * @param maxWidth - the sheet's width cap
 * @param insets - the window's insets; only `left` and `right` are read
 * @returns `width` and `marginLeft` for a sheet aligned to the left edge
 */
export function centredSheetSpan(
  windowWidth: number,
  maxWidth: number,
  insets: Pick<EdgeInsets, "left" | "right">
): { width: number; marginLeft: number } {
  const room = Math.max(0, windowWidth - insets.left - insets.right);
  const width = Math.min(maxWidth, room);
  return {
    width,
    marginLeft: insets.left + Math.floor((room - width) / 2),
  };
}
