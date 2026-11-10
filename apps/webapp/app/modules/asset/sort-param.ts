/**
 * The `name:direction[:fieldType]` grammar of an advanced-index `sortBy`
 * URL parameter.
 *
 * Deliberately dependency-free: the same split has to happen in the browser
 * (rebuilding the sort popover from the URL) and on the server (turning the
 * URL into an ORDER BY). Both sides must read the grammar the same way, or a
 * sort the server applies is misread and rewritten by the popover.
 *
 * @see {@link file://./query.server.ts} `parseSortingOptions`
 * @see {@link file://./../../components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 * @see {@link file://./filter-param.ts} the equivalent for filter parameters
 */

/** The two sort directions a `sortBy` parameter can carry. */
const SORT_DIRECTIONS = new Set(["asc", "desc"]);

/**
 * Splits a `sortBy` parameter into its name, direction and field type.
 *
 * Direction and type are read from the END: a custom field name is free text
 * and may itself contain ":" (`cf_Ratio: target:desc:NUMBER`), so splitting
 * from the start would read part of the name as the direction. A trailing
 * `asc`/`desc` is always the direction; a third segment after it is the type.
 *
 * Nothing is validated here. The server normalizes the direction (and rejects
 * an unknown one); the browser only rebuilds its controls from the parts.
 *
 * @param raw - The raw parameter value, e.g. `cf_Weight (kg):desc:NUMBER`
 * @returns A `[name, direction, fieldType]` triple. `direction` is `undefined`
 *   when the parameter carries no colon (`?sortBy=name`), and `fieldType` is
 *   `undefined` when there is no type segment.
 */
export function splitSortParam(
  raw: string
): [
  name: string,
  direction: string | undefined,
  fieldType: string | undefined,
] {
  const parts = raw.split(":");
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  const hasType = parts.length >= 3 && !SORT_DIRECTIONS.has(last);
  const fieldType = hasType ? parts.pop() : undefined;
  const direction = parts.length >= 2 ? parts.pop() : undefined;
  return [parts.join(":"), direction, fieldType];
}
