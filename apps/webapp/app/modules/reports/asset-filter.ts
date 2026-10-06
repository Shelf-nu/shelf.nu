/**
 * Asset predicate shared by every asset-based report.
 *
 * A report's filters must mean the same thing in its rows, its KPIs, its CSV
 * and its PDF. The rows and most KPIs go through Prisma, while the money KPIs
 * multiply `value × quantity` in raw SQL (Prisma's aggregate cannot), so the
 * predicate is produced in BOTH forms here, from ONE input, and a report
 * passes each form to the query that needs it. A filter that exists in one
 * form and not the other would make a headline disagree with its own table.
 *
 * Custom fields compare the stored `raw` text (what the user typed) for
 * TEXT and OPTION fields and `valueBoolean` for BOOLEAN fields. Other field
 * types are not offered as report filters: their `raw` is a number or a
 * date whose stored shape varies, so a text comparison would be unreliable.
 *
 * Pure module: no database access. Typing comes from Prisma's generated
 * client, and `@shelf/database` is a server-only package, so import this only
 * from server code.
 *
 * @see {@link file://./filters.server.ts} builds the input from a request
 * @see {@link file://./helpers.server.ts} the report functions that consume it
 */

import { CustomFieldType, type AssetStatus, Prisma } from "@prisma/client";
import { WITHOUT_LOCATION_ID } from "./filter-params";

/** A custom-field filter whose field definition has been looked up. */
export interface ResolvedCustomFieldValue {
  customFieldId: string;
  value: string;
  type: CustomFieldType;
}

/** Everything the predicate can express. Every list may be empty. */
export interface ReportAssetFilterInput {
  categoryIds?: string[];
  /** Location ids; {@link WITHOUT_LOCATION_ID} selects unplaced assets. */
  locationIds?: string[];
  assetModelIds?: string[];
  statuses?: AssetStatus[];
  customFieldValues?: ResolvedCustomFieldValue[];
}

/** The same predicate in the two forms the reports query with. */
export interface ReportAssetFilter {
  /** Prisma form, to spread into an asset `where` (no `organizationId` inside). */
  where: Prisma.AssetWhereInput;
  /**
   * Raw-SQL form: fragments to `AND` into a query over `"Asset"` with no
   * table alias, matching the existing KPI queries in `helpers.server.ts`.
   */
  sql: Prisma.Sql[];
  /** True when no filter is set, so callers can skip merging entirely. */
  isEmpty: boolean;
}

/** Custom-field types a report filter can compare reliably. */
export const REPORT_FILTERABLE_CUSTOM_FIELD_TYPES: readonly CustomFieldType[] =
  [CustomFieldType.TEXT, CustomFieldType.OPTION, CustomFieldType.BOOLEAN];

/**
 * Whether a custom field can be offered as a report filter.
 *
 * @param type - The field's type
 */
export function isReportFilterableCustomFieldType(
  type: CustomFieldType
): boolean {
  return REPORT_FILTERABLE_CUSTOM_FIELD_TYPES.includes(type);
}

/** Yes/no display values a BOOLEAN custom field filter accepts. */
export const BOOLEAN_FILTER_VALUES = {
  yes: "yes",
  no: "no",
} as const;

/**
 * Maps a boolean filter's display value to the stored boolean.
 *
 * @returns `true`/`false`, or `null` for anything that is not yes/no
 */
function parseBooleanFilterValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === BOOLEAN_FILTER_VALUES.yes || normalized === "true") {
    return true;
  }
  if (normalized === BOOLEAN_FILTER_VALUES.no || normalized === "false") {
    return false;
  }
  return null;
}

/**
 * Prisma predicate for one custom-field filter, or `null` when the filter
 * cannot be expressed (unsupported type, or a boolean value that is not
 * yes/no) and must be ignored rather than match nothing.
 */
function customFieldWhere(
  filter: ResolvedCustomFieldValue
): Prisma.AssetWhereInput | null {
  if (filter.type === CustomFieldType.BOOLEAN) {
    const bool = parseBooleanFilterValue(filter.value);
    if (bool === null) return null;
    return {
      customFields: {
        some: {
          customFieldId: filter.customFieldId,
          value: { path: ["valueBoolean"], equals: bool },
        },
      },
    };
  }

  if (!isReportFilterableCustomFieldType(filter.type)) return null;

  return {
    customFields: {
      some: {
        customFieldId: filter.customFieldId,
        value: { path: ["raw"], equals: filter.value },
      },
    },
  };
}

/**
 * Raw-SQL twin of {@link customFieldWhere}. Same acceptance rules, so the
 * money KPI and the rows always filter on the same fields.
 */
function customFieldSql(filter: ResolvedCustomFieldValue): Prisma.Sql | null {
  if (filter.type === CustomFieldType.BOOLEAN) {
    const bool = parseBooleanFilterValue(filter.value);
    if (bool === null) return null;
    return Prisma.sql`id IN (
      SELECT "assetId" FROM "AssetCustomFieldValue"
      WHERE "customFieldId" = ${filter.customFieldId}
        AND (value->>'valueBoolean')::boolean = ${bool}
    )`;
  }

  if (!isReportFilterableCustomFieldType(filter.type)) return null;

  return Prisma.sql`id IN (
    SELECT "assetId" FROM "AssetCustomFieldValue"
    WHERE "customFieldId" = ${filter.customFieldId}
      AND value->>'raw' = ${filter.value}
  )`;
}

/**
 * Builds the shared asset predicate in both forms.
 *
 * Lists are combined with AND across filter kinds and OR within one kind
 * (any of the chosen categories, any of the chosen locations), which is how
 * every multi-select in the app reads. Custom-field filters are AND-ed with
 * each other: "Perkins is yes" AND "Fiscal year is 25/26" narrows.
 *
 * @param input - The chosen filters; ids must already be scoped to the workspace
 * @returns The predicate; `isEmpty` when nothing narrows the asset set
 */
export function buildReportAssetFilter(
  input: ReportAssetFilterInput
): ReportAssetFilter {
  const and: Prisma.AssetWhereInput[] = [];
  const sql: Prisma.Sql[] = [];

  const categoryIds = input.categoryIds ?? [];
  if (categoryIds.length > 0) {
    and.push({ categoryId: { in: categoryIds } });
    sql.push(Prisma.sql`"categoryId" IN (${Prisma.join(categoryIds)})`);
  }

  const locationIds = input.locationIds ?? [];
  if (locationIds.length > 0) {
    const wantsUnplaced = locationIds.includes(WITHOUT_LOCATION_ID);
    const realLocationIds = locationIds.filter(
      (id) => id !== WITHOUT_LOCATION_ID
    );

    const placedWhere: Prisma.AssetWhereInput = {
      assetLocations: { some: { locationId: { in: realLocationIds } } },
    };
    const unplacedWhere: Prisma.AssetWhereInput = {
      assetLocations: { none: {} },
    };

    if (wantsUnplaced && realLocationIds.length > 0) {
      and.push({ OR: [placedWhere, unplacedWhere] });
      sql.push(
        Prisma.sql`(id IN (SELECT "assetId" FROM "AssetLocation" WHERE "locationId" IN (${Prisma.join(
          realLocationIds
        )})) OR id NOT IN (SELECT "assetId" FROM "AssetLocation"))`
      );
    } else if (wantsUnplaced) {
      and.push(unplacedWhere);
      sql.push(Prisma.sql`id NOT IN (SELECT "assetId" FROM "AssetLocation")`);
    } else {
      and.push(placedWhere);
      sql.push(
        Prisma.sql`id IN (SELECT "assetId" FROM "AssetLocation" WHERE "locationId" IN (${Prisma.join(
          realLocationIds
        )}))`
      );
    }
  }

  const assetModelIds = input.assetModelIds ?? [];
  if (assetModelIds.length > 0) {
    and.push({ assetModelId: { in: assetModelIds } });
    sql.push(Prisma.sql`"assetModelId" IN (${Prisma.join(assetModelIds)})`);
  }

  const statuses = input.statuses ?? [];
  if (statuses.length > 0) {
    and.push({ status: { in: statuses } });
    sql.push(Prisma.sql`status::text IN (${Prisma.join(statuses)})`);
  }

  for (const filter of input.customFieldValues ?? []) {
    const where = customFieldWhere(filter);
    const fragment = customFieldSql(filter);
    // Both forms accept or reject a filter together; a filter expressible in
    // only one of them would split the rows from the headline.
    if (!where || !fragment) continue;
    and.push(where);
    sql.push(fragment);
  }

  if (and.length === 0) {
    return { where: {}, sql: [], isEmpty: true };
  }

  return {
    where: and.length === 1 ? and[0] : { AND: and },
    sql,
    isEmpty: false,
  };
}

/**
 * Merges a report's base asset `where` with the shared filter predicate.
 *
 * Kept as an explicit AND so a base clause and a filter clause on the same
 * key (both setting `assetLocations`, say) never overwrite each other.
 *
 * @param base - The report's own predicate, `organizationId` included
 * @param filter - The shared predicate from {@link buildReportAssetFilter}
 */
export function mergeAssetWhere(
  base: Prisma.AssetWhereInput,
  filter: ReportAssetFilter | undefined
): Prisma.AssetWhereInput {
  if (!filter || filter.isEmpty) return base;
  return { AND: [base, filter.where] };
}
