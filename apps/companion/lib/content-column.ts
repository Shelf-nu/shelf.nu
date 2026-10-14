/**
 * The reading column the app's screens sit in on wide windows.
 *
 * Every screen was laid out for a phone. On a tablet, or an iPad window wider
 * than a phone, those layouts would stretch edge to edge: text fields a
 * thousand points wide, list rows read across the whole screen. Instead the
 * content stays in a centred column no wider than `CONTENT_MAX_WIDTH`, and the
 * space either side shows the screen background. Phones never reach the cap,
 * so their layout is untouched.
 *
 * Pure (no React Native import) so the maths runs under `node --test`.
 */

/** Widest the content column gets, in points. */
export const CONTENT_MAX_WIDTH = 720;

/**
 * Widest a short standalone form gets (sign-in), in points. A handful of
 * fields reads better narrower than a list or a detail screen.
 */
export const FORM_MAX_WIDTH = 480;

/**
 * Side padding that centres a column of `maxWidth` in a window this wide.
 * Zero while the window is no wider than the column.
 *
 * @param windowWidth - the window's width, in points
 * @param maxWidth - the column's width cap, `CONTENT_MAX_WIDTH` by default
 */
export function contentGutter(
  windowWidth: number,
  maxWidth: number = CONTENT_MAX_WIDTH
): number {
  return Math.max(0, Math.floor((windowWidth - maxWidth) / 2));
}

/**
 * Smallest screen side, in points, at which a device counts as a tablet.
 * Matches Android's large-screen line (`sw600dp`); every iPad clears it and
 * no phone does.
 */
const TABLET_MIN_SHORT_SIDE = 600;

/** Whether a screen this size is a tablet's, judged by its shorter side. */
export function isTabletScreen(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
}

/**
 * Window width, in points, from which the tab bar becomes a sidebar on the
 * left. Tablets held sideways clear it (iPad Air 11" is 1,180 wide, a 10"
 * Android tablet 1,280); held upright most stay below it and keep the bottom
 * tab bar. A 13" iPad is 1,024 wide even upright, so it keeps the sidebar in
 * both orientations. Phones are locked upright, so they never reach it.
 */
const TAB_SIDEBAR_MIN_WIDTH = 1000;

/** Whether a window this wide shows the tab bar as a sidebar. */
export function showsTabSidebar(windowWidth: number): boolean {
  return windowWidth >= TAB_SIDEBAR_MIN_WIDTH;
}
