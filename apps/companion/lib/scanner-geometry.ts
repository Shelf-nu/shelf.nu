/**
 * Fixed geometry of the camera scanner screen.
 *
 * `app/(tabs)/scanner.tsx` lays its overlay out from these numbers, and
 * `batch-drawer-layout.test.ts` uses the same ones to prove the tallest drawer
 * stops below the camera controls on short windows. Change a number here and
 * both follow.
 *
 * Pure and React-free so Node's test runner can import it.
 *
 * @see {@link file://./../app/(tabs)/scanner.tsx}
 * @see {@link file://./batch-drawer-layout.test.ts}
 */

/** Edge of the square scan frame, in points. */
export const SCAN_FRAME_SIZE = 240;

/** Gap between the bottom of the camera controls row and the scan frame. */
export const CONTROL_ROW_GAP = 16;

/**
 * Height the bottom tab bar takes from the scanner on an iPhone with a home
 * indicator (49pt bar plus 34pt indicator, rounded up). The tab bar's height
 * comes from React Navigation at runtime; this is the value the layout tests
 * assume, chosen on the generous side so they err toward less room.
 */
export const ASSUMED_TAB_BAR_HEIGHT = 85;
