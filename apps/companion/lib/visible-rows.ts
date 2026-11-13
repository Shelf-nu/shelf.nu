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
 * @param selectedId - The selected row, if any. When it matches the search
 *   but sorts after the cap it is drawn first, so the dropdown opens on the
 *   checked row instead of hiding it.
 * @returns The rows to draw, and how many matching rows were left out.
 */
export function visibleRows<T extends { id: string }>(
  items: T[],
  selectedId?: string | null
): { rows: T[]; hiddenCount: number } {
  const rows = items.slice(0, MAX_DROPDOWN_ROWS);
  if (selectedId && !rows.some((row) => row.id === selectedId)) {
    const selected = items.find((row) => row.id === selectedId);
    if (selected) rows.unshift(selected);
  }
  return { rows, hiddenCount: items.length - rows.length };
}

/** The hint under a capped dropdown, worded like the web pickers. */
export function moreRowsHint(shown: number, total: number) {
  return `Showing ${shown} out of ${total}, type to search for more`;
}

/** What a dropdown says under its rows when its list is not whole. */
export type IncompleteListNotice = {
  message: string;
  /** Whether loading again can help: yes after a failure, no at the limit. */
  canRetry: boolean;
};

/**
 * Words the notice for a list that is missing rows, so "No results" and the
 * "Showing 50 out of N" hint are not read as the whole truth.
 *
 * @param list - `noun` is the plural shown to the user ("locations");
 *   `error` is set when a page failed to load; `truncated` when the load
 *   stopped at its limit; `loaded` is how many rows did load.
 * @returns The notice, or `null` for a complete list.
 */
export function incompleteListNotice({
  noun,
  error,
  truncated,
  loaded,
}: {
  noun: string;
  error: string | null;
  truncated: boolean;
  loaded: number;
}): IncompleteListNotice | null {
  if (error) {
    return { message: `Couldn't load all ${noun}.`, canRetry: true };
  }
  if (truncated) {
    return {
      message: `Only the first ${loaded} ${noun} are listed.`,
      canRetry: false,
    };
  }
  return null;
}
