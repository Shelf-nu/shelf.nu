/**
 * Layout and feedback rules for the scanner's batch drawer.
 *
 * The drawer rises from the bottom of the camera screen while the camera keeps
 * running above it, so its height is capped against the window: on the
 * shortest supported phone (iPhone Duo closed, 678pt tall) the drawer must
 * stop below the camera controls that sit under the mode pills. Collapsing
 * hides the list; a scan that lands while collapsed briefly names the new row
 * in the header so the operator still sees each scan register.
 *
 * Pure and React-free so Node's test runner can cover it.
 *
 * @see {@link file://./../components/scanner/batch-drawer.tsx}
 * @see {@link file://./batch-drawer-layout.test.ts}
 */

/** Drawer cap in points with no blocker rows. */
export const DRAWER_MAX_HEIGHT = 280;
/** Drawer cap in points while blocker rows show above the submit button. */
export const DRAWER_MAX_HEIGHT_WITH_BLOCKERS = 400;
/** Largest share of the window height the drawer may take. */
export const DRAWER_MAX_WINDOW_SHARE = 0.45;
/** How long a collapsed header names the row that was just added, in ms. */
export const ADDED_FLASH_MS = 1500;

/**
 * Maximum drawer height for a window.
 *
 * @param windowHeight - `useWindowDimensions().height`, in points.
 * @param hasBlockers - Whether blocker rows are showing.
 * @returns The smaller of the fixed cap and 45% of the window height.
 */
export function batchDrawerMaxHeight(
  windowHeight: number,
  hasBlockers: boolean
): number {
  const fixedCap = hasBlockers
    ? DRAWER_MAX_HEIGHT_WITH_BLOCKERS
    : DRAWER_MAX_HEIGHT;
  return Math.min(fixedCap, Math.floor(windowHeight * DRAWER_MAX_WINDOW_SHARE));
}

/** A drawer row as far as "what was just added" is concerned. */
export type KeyedRow = { key: string; title: string };

/**
 * Rows present in `next` but not in `previousKeys`, in list order (the
 * scanner puts new rows first).
 *
 * @param previousKeys - Row keys from the last render.
 * @param next - The rows now in the drawer.
 */
export function addedRows(
  previousKeys: ReadonlySet<string>,
  next: readonly KeyedRow[]
): KeyedRow[] {
  return next.filter((row) => !previousKeys.has(row.key));
}

/**
 * Header text naming what a scan just added, e.g.
 * "4 items scanned · ZZX Fixture 14 added".
 *
 * @param title - The drawer's normal title (the count).
 * @param added - Rows the last change added; a kit can add several at once.
 * @returns The flash title, or `title` unchanged when nothing was added.
 */
export function addedFlashTitle(
  title: string,
  added: readonly KeyedRow[]
): string {
  if (added.length === 0) return title;
  const what = added.length === 1 ? added[0].title : `${added.length} items`;
  return `${title} · ${what} added`;
}
