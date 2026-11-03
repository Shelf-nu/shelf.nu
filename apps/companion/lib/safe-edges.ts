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
 * button, a scanner header): `minimum`, the offset the phone layouts are drawn
 * for, or the top inset when that is taller, so the controls never sit under
 * the status bar or a camera cutout.
 *
 * @param topInset - the window's top inset
 * @param minimum - the smallest offset, in points
 */
export function overlayTopOffset(topInset: number, minimum: number): number {
  return Math.max(topInset, minimum);
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

/** How a scanner screen splits between its camera and its list. */
export type ScanSplit = {
  /** Whether the list sits beside the camera instead of below it. */
  sideBySide: boolean;
  /** Insets on the camera area's edges. */
  camera: EdgeInsets;
  /** Insets on the list panel's edges. */
  panel: EdgeInsets;
};

/**
 * Splits a scanner screen into a camera area and a list panel, and says
 * which of the screen's insets each one touches.
 *
 * Upright, the camera sits above the list, the way a phone is held, and both
 * span the width, so both clear both side insets. On a screen wider than it
 * is tall (a foldable or a tablet turned sideways) the list moves beside the
 * camera, on the right: the camera keeps the left inset and the top, the
 * panel takes the right inset and, now reaching the top, the top inset too.
 *
 * @param screen - the scanner screen's own size, in points
 * @param insets - the insets on the screen's edges (`tabScreenInsets`)
 */
export function scanSplit(
  screen: { width: number; height: number },
  insets: EdgeInsets
): ScanSplit {
  const sideBySide = screen.width > screen.height;
  if (!sideBySide) {
    return {
      sideBySide,
      camera: { ...insets, bottom: 0 },
      panel: { ...insets, top: 0 },
    };
  }
  return {
    sideBySide,
    camera: { ...insets, right: 0 },
    panel: { ...insets, left: 0 },
  };
}
