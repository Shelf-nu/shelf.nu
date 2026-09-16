/**
 * Report filter URL parameters.
 *
 * One grammar for every report page, its CSV export and its PDF export, so a
 * filter chosen on screen reaches all three the same way. The page loader,
 * `reports.export.$fileName[.csv].tsx` and
 * `api+/reports.$reportId.generate-pdf.tsx` all parse the query string through
 * {@link parseReportFilterParams}; nothing reads a filter parameter by hand.
 *
 * Multi-value filters repeat the parameter (`category=a&category=b`), which
 * is what the shared `DynamicDropdown` writes. Comma-separated values are
 * accepted too, so the legacy `categories=a,b` spelling keeps working for
 * bookmarked links.
 *
 * Pure module: no database, no React, safe to import from the client bundle.
 *
 * @see {@link file://./filters.server.ts} resolves these ids against the workspace
 * @see {@link file://./asset-filter.ts} turns them into an asset predicate
 */

/** Query-string keys the report filter bar writes. */
export const REPORT_FILTER_PARAM = {
  category: "category",
  location: "location",
  teamMember: "teamMember",
  status: "status",
  assetModel: "assetModel",
  asset: "asset",
  /** Repeatable `cf=<customFieldId>:<value>`, see {@link encodeCustomFieldParam}. */
  customField: "cf",
} as const;

/**
 * Older spellings of the same filters. Read, never written: links created
 * before the filter bar existed must keep producing the same report.
 */
const LEGACY_REPORT_FILTER_PARAM = {
  categories: "categories",
  locations: "locations",
  statuses: "statuses",
  custodian: "custodian",
} as const;

/** Location id meaning "assets with no placement at all", shared with `/assets`. */
export const WITHOUT_LOCATION_ID = "without-location";

/** One "custom field is value" filter as it travels in the URL. */
export interface CustomFieldValueParam {
  customFieldId: string;
  /** The display text of the value, compared against the stored `raw` text. */
  value: string;
}

/** Every filter a report page can carry, already split and de-duplicated. */
export interface ReportFilterParams {
  categoryIds: string[];
  locationIds: string[];
  /** A `TeamMember` id; booking reports translate it to the custodian user. */
  teamMemberId: string | null;
  statuses: string[];
  assetModelIds: string[];
  assetId: string | null;
  customFieldValues: CustomFieldValueParam[];
}

/** The separator between a custom field id and its value inside one `cf` param. */
const CUSTOM_FIELD_PARAM_SEPARATOR = ":";

/**
 * Serialises a custom-field filter for the `cf` query parameter.
 *
 * Ids are cuids (no colon), so the FIRST colon always ends the id and the
 * value may contain colons of its own.
 *
 * @param filter - The field and the value it must equal
 * @returns `<customFieldId>:<value>`
 */
export function encodeCustomFieldParam(filter: CustomFieldValueParam): string {
  return `${filter.customFieldId}${CUSTOM_FIELD_PARAM_SEPARATOR}${filter.value}`;
}

/**
 * Parses one `cf` query value.
 *
 * @param raw - The query value as written, e.g. `clx123:yes`
 * @returns The filter, or `null` when the id or the value is missing
 */
export function decodeCustomFieldParam(
  raw: string
): CustomFieldValueParam | null {
  const separatorIndex = raw.indexOf(CUSTOM_FIELD_PARAM_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const customFieldId = raw.slice(0, separatorIndex).trim();
  const value = raw.slice(separatorIndex + 1).trim();
  if (!customFieldId || !value) return null;

  return { customFieldId, value };
}

/**
 * Reads every value of `keys` from the query string, splitting comma-joined
 * values and dropping blanks and duplicates. Order of first appearance is
 * kept so chips render in the order the user picked.
 */
function readMultiValue(
  searchParams: URLSearchParams,
  ...keys: string[]
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const key of keys) {
    for (const rawValue of searchParams.getAll(key)) {
      for (const piece of rawValue.split(",")) {
        const value = piece.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values;
}

/** Reads a single-value filter, preferring the current key over its legacy alias. */
function readSingleValue(
  searchParams: URLSearchParams,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Parses the report filter parameters out of a query string.
 *
 * Unknown or malformed values are dropped rather than rejected: a report with
 * a bad filter in the URL renders unfiltered instead of failing.
 *
 * @param searchParams - The request's query string
 * @returns The filters, ids still unverified against the workspace
 */
export function parseReportFilterParams(
  searchParams: URLSearchParams
): ReportFilterParams {
  const customFieldValues: CustomFieldValueParam[] = [];
  const seenCustomFieldParams = new Set<string>();
  for (const rawValue of searchParams.getAll(REPORT_FILTER_PARAM.customField)) {
    const decoded = decodeCustomFieldParam(rawValue);
    if (!decoded) continue;
    const key = encodeCustomFieldParam(decoded);
    if (seenCustomFieldParams.has(key)) continue;
    seenCustomFieldParams.add(key);
    customFieldValues.push(decoded);
  }

  return {
    categoryIds: readMultiValue(
      searchParams,
      REPORT_FILTER_PARAM.category,
      LEGACY_REPORT_FILTER_PARAM.categories
    ),
    locationIds: readMultiValue(
      searchParams,
      REPORT_FILTER_PARAM.location,
      LEGACY_REPORT_FILTER_PARAM.locations
    ),
    teamMemberId: readSingleValue(
      searchParams,
      REPORT_FILTER_PARAM.teamMember,
      LEGACY_REPORT_FILTER_PARAM.custodian
    ),
    statuses: readMultiValue(
      searchParams,
      REPORT_FILTER_PARAM.status,
      LEGACY_REPORT_FILTER_PARAM.statuses
    ),
    assetModelIds: readMultiValue(searchParams, REPORT_FILTER_PARAM.assetModel),
    assetId: readSingleValue(searchParams, REPORT_FILTER_PARAM.asset),
    customFieldValues,
  };
}

/**
 * Whether any filter is set. Used to skip the id-resolution queries and to
 * decide whether a "Clear all" control has anything to clear.
 */
export function hasActiveReportFilters(params: ReportFilterParams): boolean {
  return (
    params.categoryIds.length > 0 ||
    params.locationIds.length > 0 ||
    params.teamMemberId !== null ||
    params.statuses.length > 0 ||
    params.assetModelIds.length > 0 ||
    params.assetId !== null ||
    params.customFieldValues.length > 0
  );
}

/**
 * Query-string keys, current and legacy, that carry report filters. The
 * filter bar's "Clear all" removes exactly these and leaves the timeframe,
 * sort and paging keys alone.
 */
export const ALL_REPORT_FILTER_PARAM_KEYS: readonly string[] = [
  ...Object.values(REPORT_FILTER_PARAM),
  ...Object.values(LEGACY_REPORT_FILTER_PARAM),
];
