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
 * Tallest an inline dropdown grows, in points. Sized so that the search box,
 * {@link MIN_VISIBLE_DROPDOWN_ROWS} rows and the clear row all fit at once.
 */
export const DROPDOWN_MAX_HEIGHT = 280;

/** Rows an open inline dropdown must show without scrolling. */
export const MIN_VISIBLE_DROPDOWN_ROWS = 4;

/**
 * Heights, in points, of the fixed parts of an inline dropdown as the asset
 * forms style them (14pt text, 12pt row padding, 10pt search and clear
 * padding), rounded up.
 */
export const DROPDOWN_PART_HEIGHTS = { search: 44, row: 44, clear: 42 };

/**
 * Filters rows by a search on their name and puts the closest matches first:
 * the row named exactly like the search, then names that start with it, then
 * names that only contain it. Each group keeps the list's own order.
 *
 * The dropdown draws only the first {@link MAX_DROPDOWN_ROWS} matches, so
 * without this a row could stay out of reach: "Store" after fifty rows named
 * "Annex Store 0xx" matches every search those rows match. Ranked, typing a
 * row's full name always brings it to the top.
 *
 * @param items - Every row the field holds, in list order.
 * @param search - What the user typed; matched case-insensitively.
 * @returns The matching rows, closest first, or `items` for an empty search.
 */
export function searchRows<T extends { name: string }>(
  items: T[],
  search: string
): T[] {
  const query = search.toLowerCase();
  if (!query) return items;

  const exact: T[] = [];
  const startsWith: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    if (name === query) exact.push(item);
    else if (name.startsWith(query)) startsWith.push(item);
    else if (name.includes(query)) contains.push(item);
  }
  return [...exact, ...startsWith, ...contains];
}

/**
 * Picks the rows an inline dropdown draws: the first
 * {@link MAX_DROPDOWN_ROWS}, led by the selected row when it sorts after
 * them.
 *
 * @param items - The rows that match the current search.
 * @param selectedId - The selected row, if any. When it matches the search
 *   but sorts after the cap it is drawn first, in place of the last capped
 *   row, so the dropdown opens on the checked row instead of hiding it and
 *   still draws at most {@link MAX_DROPDOWN_ROWS} rows.
 * @returns The rows to draw, and how many matching rows were left out.
 */
export function visibleRows<T extends { id: string }>(
  items: T[],
  selectedId?: string | null
): { rows: T[]; hiddenCount: number } {
  let rows = items.slice(0, MAX_DROPDOWN_ROWS);
  if (selectedId && !rows.some((row) => row.id === selectedId)) {
    const selected = items.find((row) => row.id === selectedId);
    if (selected) {
      rows = [selected, ...items.slice(0, MAX_DROPDOWN_ROWS - 1)];
    }
  }
  return { rows, hiddenCount: items.length - rows.length };
}

/**
 * The hint under a capped dropdown, worded like the web pickers.
 *
 * @param shown - How many rows the dropdown draws.
 * @param total - How many rows match the current search.
 * @returns The hint text.
 */
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
