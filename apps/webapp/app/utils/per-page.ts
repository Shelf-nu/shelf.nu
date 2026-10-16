/**
 * Page sizes for paginated lists.
 *
 * The per-page menu offers exactly these sizes, and the `user-prefs` cookie
 * only ever remembers one of them. Any other `?per_page=` value (a hand-edited
 * or shared link) is not remembered, and a stored value outside this list
 * resolves to the default, so no list gets stuck on a size the menu cannot show.
 *
 * @see {@link file://./cookies.server.ts} updateCookieWithPerPage
 * @see {@link file://../components/list/pagination/per-page-items-select.tsx}
 */

/** The sizes the per-page menu offers, smallest first. */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;

/** The size a list uses when nothing valid is remembered. */
export const DEFAULT_PER_PAGE = PER_PAGE_OPTIONS[0];

/** One of the sizes the per-page menu offers. */
export type PerPageOption = (typeof PER_PAGE_OPTIONS)[number];

/**
 * Whether a value is one of the sizes the per-page menu offers.
 *
 * @param value - A page size from the URL or a cookie, of unknown shape
 */
export function isPerPageOption(value: unknown): value is PerPageOption {
  return PER_PAGE_OPTIONS.includes(value as PerPageOption);
}
