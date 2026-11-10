/**
 * The values each Postgres-enum filter of the Advanced assets index accepts.
 *
 * The query (`query.server.ts`) answers a value outside these with a 400, and
 * the filter cookie (`cookies.server.ts`) refuses to remember one, so a filter
 * the query rejects can never be restored onto every later visit to /assets.
 * Both read this module so they cannot disagree about what is rejected.
 *
 * @see {@link file://./query.server.ts} `assertEnumFilterValues`
 * @see {@link file://./../../utils/cookies.server.ts} `getAdvancedFiltersFromRequest`
 */
import { AssetStatus, AssetType } from "@prisma/client";
import { splitFilterParam } from "./filter-param";

/** The accepted values of each enum filter, keyed by its URL param. */
export const ENUM_FILTER_VALUES: Record<"status" | "type", readonly string[]> =
  {
    status: Object.values(AssetStatus),
    type: Object.values(AssetType),
  };

/** An Advanced-index filter backed by a Postgres enum. */
export type EnumFilterName = keyof typeof ENUM_FILTER_VALUES;

/**
 * The values an enum filter does not accept.
 *
 * @param name - The enum filter being checked
 * @param values - The filter's values, already split and trimmed
 * @returns The rejected values, empty when every value is accepted
 */
export function getUnknownEnumFilterValues(
  name: EnumFilterName,
  values: string[]
): string[] {
  const accepted = ENUM_FILTER_VALUES[name];
  return values.filter((value) => !accepted.includes(value));
}

/**
 * Whether an `operator:value` filter param carries an enum value the query
 * would reject. Reads the value the way the query does: `containsAny` as a
 * comma-separated list, every other operator as one trimmed value.
 *
 * @param key - The URL param name, e.g. `status`
 * @param raw - The param value in operator form, e.g. `is:ARCHIVED`
 * @returns `true` when `key` is an enum filter and any value is rejected
 */
export function hasUnknownEnumFilterValue(key: string, raw: string): boolean {
  if (!Object.hasOwn(ENUM_FILTER_VALUES, key)) return false;

  const [operator, value = ""] = splitFilterParam(raw);
  const values =
    operator === "containsAny"
      ? value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [value.trim()];

  return getUnknownEnumFilterValues(key as EnumFilterName, values).length > 0;
}
