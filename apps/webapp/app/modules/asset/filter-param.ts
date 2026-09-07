/**
 * The `operator:value` grammar of an advanced-filter URL parameter.
 *
 * Deliberately dependency-free: the same split has to happen in the browser
 * (rebuilding the filter UI from the URL), on the server (turning the URL into
 * a query), and in the validation that decides whether a parameter survives at
 * all. Three readings of one grammar is how they drift.
 *
 * @see {@link file://./filter-parsing.ts} the server/shared parser
 * @see {@link file://./utils.server.ts} `advancedFilterFormatSchema`
 * @see {@link file://./../../components/assets/assets-index/advanced-filters/helpers.ts}
 */

/**
 * Splits a filter parameter on its FIRST colon.
 *
 * Only the first colon separates the operator from the value; the rest belong
 * to the value, which is user data. Code128, DataMatrix and ExternalQR codes
 * all permit colons and a URL custom field is mostly colon, so splitting on
 * every colon and keeping the second field silently truncates the value — and
 * where the count of fields is used to validate the parameter, drops the
 * filter entirely.
 *
 * @param raw - The raw parameter value, e.g. `is:ABC:123`
 * @returns A `[operator, value]` pair. `value` is `undefined` when the
 *   parameter carries no colon at all, which is not the same as a colon with
 *   nothing after it (`""`) — callers gate on the difference.
 */
export function splitFilterParam(
  raw: string
): [operator: string, value: string | undefined] {
  const separator = raw.indexOf(":");

  return separator === -1
    ? [raw, undefined]
    : [raw.slice(0, separator), raw.slice(separator + 1)];
}
