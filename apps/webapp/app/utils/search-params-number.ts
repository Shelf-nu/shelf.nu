/**
 * Reading a number out of a query string.
 *
 * `parseInt` answers `NaN` for anything it cannot read, and `NaN` is not the
 * same as absent: the usual `parseInt(params.get("page") || "1", 10)` guards
 * only the missing case, so `?page=abc` produces `NaN` and carries it into
 * whatever the value feeds — a `skip`, a `take`, a date arithmetic — where it
 * surfaces as an empty result or a thrown query rather than as a bad request.
 *
 * Query strings are user-supplied and reachable from any link, so this is the
 * ordinary path rather than an edge case.
 */

/**
 * Reads an integer query parameter, falling back when it is absent OR
 * unreadable.
 *
 * @param searchParams - The request's parsed query string
 * @param key - The parameter to read
 * @param fallback - Used when the parameter is missing, empty, or not a number
 * @param options.min - Clamp the result to at least this, after parsing
 * @returns A usable integer — never `NaN`
 */
export function getIntParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
  options?: { min?: number }
): number {
  const parsed = Number.parseInt(searchParams.get(key) ?? "", 10);
  const value = Number.isNaN(parsed) ? fallback : parsed;

  return options?.min === undefined ? value : Math.max(options.min, value);
}
