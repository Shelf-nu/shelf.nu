/**
 * Hooks that read the live safe-area insets for controls floating over a
 * screen, so a Duo's status-bar rail or a foldable's camera cutout never
 * covers them.
 *
 * @see lib/safe-edges.ts for the maths and why the sides differ
 */

import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  centredSheetSpan,
  overlayTopOffset,
  tabScreenInsets,
  type EdgeInsets,
} from "@/lib/safe-edges";

/**
 * Top offset the phone layouts give a full-window overlay's controls: below
 * the status bar of an upright iPhone, or of an Android phone.
 */
const OVERLAY_MIN_TOP = Platform.OS === "ios" ? 60 : 40;

/**
 * Insets on the edges of a screen inside the tab navigator: the window's
 * insets less what the tab bar or sidebar already covers. Follows rotation
 * and window resizes.
 *
 * Used by the content column and by the tab screens outside it (the
 * scanners). A full-window `Modal` covers the tab bar too, so it reads the
 * window's own insets (`useOverlayEdges()` with no argument,
 * `useCentredSheetSpan`).
 */
export function useTabScreenInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return tabScreenInsets(insets, width);
}

/**
 * Where a full-window overlay (an image viewer in a `Modal`, a scanner's
 * header) places controls against its edges: `top` is the offset for its top
 * row, already clear of the status bar or cutout; `left`, `right` and `bottom`
 * are the window's insets on those edges, to add to each control's own gap.
 *
 * @param insets - the insets of the surface the overlay covers; the window's
 *   by default, or `useTabScreenInsets()` for a screen above the tab bar
 */
export function useOverlayEdges(insets?: EdgeInsets): EdgeInsets {
  const windowInsets = useSafeAreaInsets();
  const edges = insets ?? windowInsets;
  return {
    top: overlayTopOffset(edges.top, OVERLAY_MIN_TOP),
    right: edges.right,
    bottom: edges.bottom,
    left: edges.left,
  };
}

/**
 * Width and left offset for a bottom sheet in a full-window `Modal`, held to
 * a column of `maxWidth` and centred between the window's side insets.
 * Follows rotation and window resizes.
 *
 * @param maxWidth - the sheet's width cap
 * @returns style to spread onto the sheet, which must align to the left edge
 */
export function useCentredSheetSpan(maxWidth: number): {
  width: number;
  marginLeft: number;
  alignSelf: "flex-start";
} {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return {
    ...centredSheetSpan(width, maxWidth, insets),
    alignSelf: "flex-start",
  };
}
