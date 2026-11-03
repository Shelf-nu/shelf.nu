/**
 * Hooks that read the content column's side padding from the live window.
 *
 * `components/content-column.tsx` uses the gutter to decide when a screen is
 * wide enough to show the background either side of the column; full-screen
 * sheets use it as padding, since they sit outside any navigator's
 * `screenLayout`.
 *
 * @see lib/content-column.ts for the column widths
 */

import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTENT_MAX_WIDTH, contentGutter } from "@/lib/content-column";

/**
 * Side padding that keeps a screen's content in the reading column (see
 * `lib/content-column.ts`). Follows the window, so it updates when a tablet
 * rotates or an iPad window is resized. Zero on phones.
 *
 * @param maxWidth - the column's width cap, `CONTENT_MAX_WIDTH` by default
 */
export function useContentGutter(maxWidth: number = CONTENT_MAX_WIDTH): number {
  const { width } = useWindowDimensions();
  return contentGutter(width, maxWidth);
}

/**
 * Style that holds a full-screen sheet's content in the reading column.
 *
 * Android presents `pageSheet` modals full screen, so on a tablet a sheet would
 * stretch edge to edge like any screen. iOS presents them as a card the system
 * sizes for the screen, and a gutter measured from the window would squeeze
 * that card, so on iOS this adds nothing.
 *
 * Spread it onto the sheet's outermost container, a `SafeAreaView` padding
 * all edges. That view already pads each side by its inset (a turned
 * foldable's camera cutout), so each side here adds only what the gutter
 * needs beyond it: the column stays centred and clear of the cutout.
 */
export function useSheetColumnStyle(): {
  paddingLeft: number;
  paddingRight: number;
} {
  const gutter = useContentGutter();
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "android") return { paddingLeft: 0, paddingRight: 0 };
  return {
    paddingLeft: Math.max(0, gutter - insets.left),
    paddingRight: Math.max(0, gutter - insets.right),
  };
}
