/**
 * Collects every page of a paginated list endpoint into one array.
 *
 * Use it for pickers that search only the rows they hold: the server returns
 * one page per request, so a picker that keeps page 1 cannot offer anything
 * that sorts after it. Locations, for example, come 100 per page at most.
 *
 * Pure (no React Native or Expo imports) so it runs under the Node test runner.
 */

/** One page of a list response: its rows and how many pages exist. */
export type PageResult<T> = {
  data?: ({ totalPages?: number } & T) | null;
  error?: string | null;
};

/** Rows per request; the mobile list routes accept at most 100. */
export const ALL_PAGES_PAGE_SIZE = 100;

/** Upper bound on requests, so a huge workspace cannot loop for ever. */
export const ALL_PAGES_HARD_STOP = 50;

/** What a walk can be told beyond where its pages and rows come from. */
export type FetchAllPagesOptions = {
  /**
   * Checked after each page; returning `false` stops the walk (a newer search
   * or workspace made this one obsolete). The result is then incomplete and
   * the caller drops it.
   */
  isCurrent?: () => boolean;
  /** The error reported for a page that has neither data nor an error. */
  fallbackError?: string;
};

/**
 * Requests pages 1, 2, ... until `totalPages` (or the hard stop) is reached.
 *
 * A row is kept once, by `id`: pages are fetched (and cached) separately, so
 * a list that changed between two page requests can hand the same row back on
 * both sides of a page boundary.
 *
 * @param fetchPage - Fetches one page, given its number and page size.
 * @param pickRows - Reads the rows out of a page's data.
 * @param options - See {@link FetchAllPagesOptions}.
 * @returns Every row in page order (the rows loaded so far on an error), the
 *   first error, and `truncated` when the hard stop ended the walk before the
 *   last page.
 */
export async function fetchAllPages<T, Row extends { id: string }>(
  fetchPage: (page: number, perPage: number) => Promise<PageResult<T>>,
  pickRows: (data: T) => Row[],
  {
    isCurrent = () => true,
    fallbackError = "Failed to load",
  }: FetchAllPagesOptions = {}
): Promise<{ rows: Row[]; error: string | null; truncated: boolean }> {
  const rows: Row[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; ; page += 1) {
    const { data, error } = await fetchPage(page, ALL_PAGES_PAGE_SIZE);
    if (error || !data) {
      return { rows, error: error || fallbackError, truncated: false };
    }

    for (const row of pickRows(data)) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      rows.push(row);
    }
    if (!isCurrent()) {
      return { rows, error: null, truncated: true };
    }

    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages) {
      return { rows, error: null, truncated: false };
    }
    if (page >= ALL_PAGES_HARD_STOP) {
      return { rows, error: null, truncated: true };
    }
  }
}
