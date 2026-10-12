import { Platform, useWindowDimensions } from "react-native";
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
 * Spread it onto the sheet's outermost container.
 */
export function useSheetColumnStyle(): { paddingHorizontal: number } {
  const gutter = useContentGutter();
  return { paddingHorizontal: Platform.OS === "android" ? gutter : 0 };
}
