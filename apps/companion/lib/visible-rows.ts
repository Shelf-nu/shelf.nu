/**
 * Caps how many rows an inline dropdown draws.
 *
 * The inline pickers on the asset forms live inside the screen's ScrollView,
 * so they cannot use a virtualized list. Drawing a few hundred rows there
 * makes the dropdown slow to open, so they draw the first rows only and ask
 * the user to type: every row stays reachable through the search box.
 *
 * Pure (no React Native or Expo imports) so it runs under the Node test runner.
 */

/** Most rows an inline dropdown draws at once. */
export const MAX_DROPDOWN_ROWS = 50;

/**
 * @param items - The rows that match the current search.
 * @returns The rows to draw, and how many matching rows were left out.
 */
export function visibleRows<T>(items: T[]): { rows: T[]; hiddenCount: number } {
  return {
    rows: items.slice(0, MAX_DROPDOWN_ROWS),
    hiddenCount: Math.max(0, items.length - MAX_DROPDOWN_ROWS),
  };
}

/** The hint under a capped dropdown, worded like the web pickers. */
export function moreRowsHint(shown: number, total: number) {
  return `Showing ${shown} out of ${total}, type to search for more`;
}
