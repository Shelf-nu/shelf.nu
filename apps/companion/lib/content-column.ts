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
 *
 * Foldables land on both sides of it. The iPhone Duo's inner display (951 x
 * 669 pt) and a Pixel Fold's inner screen (about 852 x 883 dp) are tablets;
 * their outer displays (466 x 678 pt, 443 x 994 dp) are phones.
 */
const TABLET_MIN_SHORT_SIDE = 600;

/** Whether a screen this size is a tablet's, judged by its shorter side. */
export function isTabletScreen(width: number, height: number): boolean {
  return Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
}

/**
 * Window width, in points, from which the tab bar becomes a sidebar on the
 * left.
 *
 * Wide windows clear it: an iPhone Duo opened sideways (951 wide), an iPad
 * mini or iPad Air held sideways (1,133 and 1,180), a 10" Android tablet
 * sideways (1,280), and a 13" iPad in either orientation (1,024 upright).
 * Upright iPads (820 to 834 wide), an upright Duo (669), a Pixel Fold's
 * inner screen (852 to 883 either way) and every phone or split-screen window
 * stay below it and keep the bottom tab bar: the sidebar is 360 wide, and
 * below this width it would leave the screen a phone's width or less.
 *
 * Decided by the window, never by the device or its orientation: an iPad or
 * Duo window can be resized to any width.
 */
const TAB_SIDEBAR_MIN_WIDTH = 900;

/** Whether a window this wide shows the tab bar as a sidebar. */
export function showsTabSidebar(windowWidth: number): boolean {
  return windowWidth >= TAB_SIDEBAR_MIN_WIDTH;
}
