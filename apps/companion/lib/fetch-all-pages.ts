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

/**
 * Requests pages 1, 2, ... until `totalPages` (or the hard stop) is reached.
 *
 * @param fetchPage - Fetches one page, given its number and page size.
 * @param pickRows - Reads the rows out of a page's data.
 * @returns Every row in page order, or the first error.
 */
export async function fetchAllPages<T, Row>(
  fetchPage: (page: number, perPage: number) => Promise<PageResult<T>>,
  pickRows: (data: T) => Row[]
): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await fetchPage(page, ALL_PAGES_PAGE_SIZE);
    if (error || !data) {
      return { rows, error: error || "Failed to load" };
    }

    rows.push(...pickRows(data));

    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages || page >= ALL_PAGES_HARD_STOP) {
      return { rows, error: null };
    }
  }
}
