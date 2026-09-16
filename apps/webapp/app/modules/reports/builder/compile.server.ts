/**
 * Report builder compiler: a {@link BuilderSpec} in, one grouped result out.
 *
 * Every spec becomes ONE grouped SQL query (plus one ungrouped twin for the
 * headline totals) over a `filtered_assets` CTE that carries the workspace
 * scope and the shared report filters. Identifiers come from closed maps
 * keyed by the whitelisted spec values; user input only ever travels as a
 * bound parameter, so no spec can name a column or table.
 *
 * Counting rules, shared with the fixed reports:
 * - Bookings: DRAFT and CANCELLED never count; a booking counts when it
 *   overlaps the period at all; one asset on one booking counts once even when
 *   the booking holds several slices of it (standalone + kit-driven); days are
 *   the booking's overlap with the period, floored at one day.
 * - Money is `Asset.value × units` (the column is `value`; the Prisma field is
 *   `valuation`); units are the surface's quantity: workspace stock for
 *   assets, units at the location when grouping by location, units in the kit
 *   when grouping by kit, `Custody.quantity` for custody.
 * - Distinct measures (assets, bookings) are totalled by the ungrouped query,
 *   because an asset at two locations sits in two groups.
 *
 * @see {@link file://./spec.ts}
 * @see {@link file://../asset-filter.ts} the shared predicate, SQL form
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import { type Currency, Prisma } from "@prisma/client";
import { ASSET_STATUS_LABELS } from "@shelf/labels";
import { DateTime } from "luxon";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { resolveTeamMemberName, resolveUserDisplayName } from "~/utils/user";
import type { ReportAssetFilter } from "../asset-filter";
import { formatKpiCurrency } from "../helpers.server";
import type { ChartSeries, ReportKpi, ResolvedTimeframe } from "../types";
import {
  AVERAGE_MEASURES,
  BUILDER_CHART_GROUPS,
  BUILDER_MAX_GROUPS,
  DATASET_GROUP_BYS,
  DATASET_MEASURES,
  GROUP_BY_LABELS,
  MEASURE_FORMAT,
  MEASURE_LABELS,
  type BuilderDataset,
  type BuilderGroupBy,
  type BuilderMeasure,
  type BuilderRow,
  type BuilderSpec,
} from "./spec";

/** Inputs for one run. */
export interface RunBuilderReportArgs {
  organizationId: string;
  spec: BuilderSpec;
  /** Period for the bookings dataset; ignored by the others. */
  timeframe: ResolvedTimeframe;
  /** IANA zone the month grouping buckets in. */
  timeZone: string;
  /** Shared report filters, SQL form used. */
  assetFilter: ReportAssetFilter;
  /** Workspace currency for the money KPI string. */
  currency: Currency;
  /**
   * The verified custom field when `spec.groupBy` is `customField`; `null`
   * makes the run fall back to the dataset's first grouping.
   */
  customField: { id: string; name: string } | null;
}

/** One run's output, shaped for the shared report components. */
export interface BuilderReportResult {
  /** The spec that actually ran (after any grouping fallback). */
  spec: BuilderSpec;
  rows: BuilderRow[];
  kpis: ReportKpi[];
  chartSeries: ChartSeries[];
  /** Group count before truncation to {@link BUILDER_MAX_GROUPS}. */
  totalGroups: number;
  truncated: boolean;
  computedMs: number;
}

const label = "Report" as const;

/** Row key used for the bucket of things with no value for the grouping. */
export const NO_GROUP_KEY = "none";

/**
 * Grouped-query row: the key, every measure the dataset computes, and the
 * number of groups the whole result has (a window count, so it survives the
 * LIMIT on the statement).
 */
export type GroupedRow = { key: string | null; groupCount: number } & Partial<
  Record<BuilderMeasure, number>
>;

/** Totals-query row: every measure over the ungrouped set. */
export type TotalsRow = Partial<Record<BuilderMeasure, number>>;

/** SQL pieces a grouping contributes to the `keyed` CTE. */
interface GroupSql {
  /** JOIN clause(s) against the asset alias `a` (and `s`/`c` per dataset). */
  join: Prisma.Sql;
  /** Expression yielding the text group key, NULL for "no value". */
  key: Prisma.Sql;
  /** Units expression for the assets dataset (stock, or units at the group). */
  units: Prisma.Sql;
}

/** Column alias per measure, quoted for ORDER BY. All from a closed map. */
const MEASURE_COLUMN: Record<BuilderMeasure, Prisma.Sql> = {
  assetCount: Prisma.raw(`"assetCount"`),
  units: Prisma.raw(`"units"`),
  totalValue: Prisma.raw(`"totalValue"`),
  bookingCount: Prisma.raw(`"bookingCount"`),
  assetsBooked: Prisma.raw(`"assetsBooked"`),
  unitsBooked: Prisma.raw(`"unitsBooked"`),
  daysBooked: Prisma.raw(`"daysBooked"`),
  custodyCount: Prisma.raw(`"custodyCount"`),
  custodyUnits: Prisma.raw(`"custodyUnits"`),
  avgDaysInCustody: Prisma.raw(`"avgDaysInCustody"`),
};

/** Label for the NULL-key bucket per grouping. */
const NO_GROUP_LABEL: Record<BuilderGroupBy, string> = {
  none: "All",
  category: "No category",
  location: "No location",
  status: "Unknown status",
  assetModel: "No model",
  kit: "Not in a kit",
  customField: "No value",
  custodian: "No custodian",
  month: "Unknown month",
};

const STOCK_UNITS = Prisma.sql`COALESCE(a.quantity, 1)`;

/**
 * SQL for one grouping. Booking-only groupings read the `slices` alias `s`;
 * custody's custodian reads the `Custody` alias `c`.
 */
function groupSql(
  dataset: BuilderDataset,
  groupBy: BuilderGroupBy,
  customFieldId: string | null,
  timeZone: string,
  organizationId: string
): GroupSql {
  switch (groupBy) {
    case "none":
      return {
        join: Prisma.empty,
        key: Prisma.sql`'all'::text`,
        units: STOCK_UNITS,
      };
    case "category":
      return {
        join: Prisma.empty,
        key: Prisma.sql`a."categoryId"`,
        units: STOCK_UNITS,
      };
    case "status":
      return {
        join: Prisma.empty,
        key: Prisma.sql`a.status::text`,
        units: STOCK_UNITS,
      };
    case "assetModel":
      return {
        join: Prisma.empty,
        key: Prisma.sql`a."assetModelId"`,
        units: STOCK_UNITS,
      };
    case "location":
      return {
        // The workspace predicate lets the planner read the placements through
        // the organization index instead of scanning the whole table.
        join: Prisma.sql`LEFT JOIN "AssetLocation" al
          ON al."assetId" = a.id AND al."organizationId" = ${organizationId}`,
        key: Prisma.sql`al."locationId"`,
        // Units placed at that location; an unplaced asset keeps its stock.
        units: Prisma.sql`COALESCE(al.quantity, COALESCE(a.quantity, 1))`,
      };
    case "kit":
      return {
        join: Prisma.sql`LEFT JOIN "AssetKit" ak ON ak."assetId" = a.id`,
        key: Prisma.sql`ak."kitId"`,
        // Units inside that kit; an asset in no kit keeps its stock.
        units: Prisma.sql`COALESCE(ak.quantity, COALESCE(a.quantity, 1))`,
      };
    case "customField":
      return {
        // A plain join, not a per-asset lateral lookup: the planner hashes the
        // field's values once (one index read on `customFieldId`) instead of
        // probing the value table once per asset, which costs seconds on a
        // cold cache for a few thousand assets.
        join: Prisma.sql`LEFT JOIN "AssetCustomFieldValue" cf
          ON cf."assetId" = a.id AND cf."customFieldId" = ${customFieldId}`,
        key: Prisma.sql`NULLIF(TRIM(cf.value->>'raw'), '')`,
        units: STOCK_UNITS,
      };
    case "custodian":
      return {
        join: Prisma.empty,
        key:
          dataset === "custody"
            ? Prisma.sql`c."teamMemberId"`
            : // A booking names its custodian as a team member or as a user;
              // user ids are prefixed so the two id spaces cannot collide.
              Prisma.sql`COALESCE(s.custodian_team_member_id, 'user:' || s.custodian_user_id)`,
        units: STOCK_UNITS,
      };
    case "month":
      return {
        join: Prisma.empty,
        key: Prisma.sql`to_char(s.booking_from AT TIME ZONE ${timeZone}, 'YYYY-MM')`,
        units: STOCK_UNITS,
      };
  }
}

/** The workspace-scoped, filter-applied asset set every dataset starts from. */
function filteredAssetsCte(
  organizationId: string,
  assetFilter: ReportAssetFilter
): Prisma.Sql {
  const where = Prisma.join(
    [Prisma.sql`"organizationId" = ${organizationId}`, ...assetFilter.sql],
    " AND "
  );
  return Prisma.sql`filtered_assets AS (
    SELECT id, "categoryId", "assetModelId", status, value, quantity
    FROM "Asset"
    WHERE ${where}
  )`;
}

/** The `keyed` CTE: one row per counted thing, with its group key. */
function keyedCte(
  dataset: BuilderDataset,
  group: GroupSql,
  organizationId: string,
  timeframe: ResolvedTimeframe
): Prisma.Sql {
  switch (dataset) {
    case "assets":
      return Prisma.sql`keyed AS (
        SELECT a.id AS asset_id, ${group.key} AS key, ${group.units} AS units,
               COALESCE(a.value, 0) AS unit_value
        FROM filtered_assets a ${group.join}
      )`;
    case "bookings":
      return Prisma.sql`slices AS (
        SELECT ba."bookingId" AS booking_id, ba."assetId" AS asset_id,
               SUM(ba.quantity)::int AS units,
               b."from" AS booking_from, b."to" AS booking_to,
               b."custodianTeamMemberId" AS custodian_team_member_id,
               b."custodianUserId" AS custodian_user_id
        FROM "BookingAsset" ba
        JOIN "Booking" b ON b.id = ba."bookingId"
        JOIN filtered_assets fa ON fa.id = ba."assetId"
        WHERE b."organizationId" = ${organizationId}
          AND b.status::text NOT IN ('DRAFT', 'CANCELLED')
          AND b."from" <= ${timeframe.to}::timestamptz
          AND b."to" >= ${timeframe.from}::timestamptz
        GROUP BY ba."bookingId", ba."assetId", b."from", b."to",
                 b."custodianTeamMemberId", b."custodianUserId"
      ),
      keyed AS (
        SELECT s.booking_id, s.asset_id, s.units, ${group.key} AS key,
               GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
                 LEAST(s.booking_to, ${timeframe.to}::timestamptz)
                 - GREATEST(s.booking_from, ${timeframe.from}::timestamptz)
               )) / 86400.0)) AS days
        FROM slices s
        JOIN filtered_assets a ON a.id = s.asset_id ${group.join}
      )`;
    case "custody":
      return Prisma.sql`keyed AS (
        SELECT c."assetId" AS asset_id, c.quantity AS units, c."createdAt" AS since,
               COALESCE(a.value, 0) AS unit_value, ${group.key} AS key
        FROM "Custody" c
        JOIN filtered_assets a ON a.id = c."assetId" ${group.join}
      )`;
  }
}

/** The measure columns each dataset's final SELECT computes over `keyed`. */
function measureColumns(dataset: BuilderDataset): Prisma.Sql {
  switch (dataset) {
    case "assets":
      return Prisma.sql`COUNT(DISTINCT asset_id)::int AS "assetCount",
        COALESCE(SUM(units), 0)::float AS "units",
        COALESCE(SUM(unit_value * units), 0)::float AS "totalValue"`;
    case "bookings":
      return Prisma.sql`COUNT(DISTINCT booking_id)::int AS "bookingCount",
        COUNT(DISTINCT asset_id)::int AS "assetsBooked",
        COALESCE(SUM(units), 0)::float AS "unitsBooked",
        COALESCE(SUM(days), 0)::float AS "daysBooked"`;
    case "custody":
      return Prisma.sql`COUNT(DISTINCT asset_id)::int AS "custodyCount",
        COALESCE(SUM(units), 0)::float AS "custodyUnits",
        COALESCE(SUM(unit_value * units), 0)::float AS "totalValue",
        COALESCE(AVG(EXTRACT(EPOCH FROM (now() - since)) / 86400.0), 0)::float AS "avgDaysInCustody"`;
  }
}

/**
 * Builds the grouped query and the headline-totals query for a spec.
 *
 * The totals run over the set keyed with no grouping at all. A grouping's
 * join can repeat a row (a quantity-tracked asset placed at two locations
 * appears once per placement), which is right for the rows of that grouping
 * but must never leak into the headline: the same filters give the same
 * totals whatever the grouping. The grouped statement carries the number of
 * groups as a window count.
 *
 * Exported for tests, which assert on the SQL text: mapped column names,
 * status exclusions, and the absence of any user-supplied text.
 */
export function compileBuilderQueries(args: {
  organizationId: string;
  spec: BuilderSpec;
  timeframe: ResolvedTimeframe;
  timeZone: string;
  assetFilter: ReportAssetFilter;
}): { grouped: Prisma.Sql; totals: Prisma.Sql } {
  const { organizationId, spec, timeframe, timeZone, assetFilter } = args;
  const group = groupSql(
    spec.dataset,
    spec.groupBy,
    spec.customFieldId,
    timeZone,
    organizationId
  );
  const ungrouped = groupSql(
    spec.dataset,
    "none",
    null,
    timeZone,
    organizationId
  );
  const ctesFor = (g: GroupSql) =>
    Prisma.sql`WITH ${filteredAssetsCte(organizationId, assetFilter)},
    ${keyedCte(spec.dataset, g, organizationId, timeframe)}`;
  const columns = measureColumns(spec.dataset);

  const grouped = Prisma.sql`${ctesFor(group)}
    SELECT key, ${columns}, COUNT(*) OVER ()::int AS "groupCount"
    FROM keyed
    GROUP BY key
    ORDER BY ${MEASURE_COLUMN[spec.measure]} DESC NULLS LAST, key ASC NULLS LAST
    LIMIT ${BUILDER_MAX_GROUPS + 1}`;

  const totals = Prisma.sql`${ctesFor(ungrouped)}
    SELECT ${columns}
    FROM keyed`;

  return { grouped, totals };
}

/**
 * Resolves group keys to display names, workspace-scoped. Keys that resolve
 * to nothing render as "Unknown" rather than leaking an id.
 */
async function resolveGroupNames(
  groupBy: BuilderGroupBy,
  keys: string[],
  organizationId: string
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (keys.length === 0) return names;

  switch (groupBy) {
    case "none":
      keys.forEach((k) => names.set(k, "All"));
      return names;
    case "status":
      keys.forEach((k) =>
        names.set(
          k,
          ASSET_STATUS_LABELS[k as keyof typeof ASSET_STATUS_LABELS] ?? k
        )
      );
      return names;
    case "customField":
      keys.forEach((k) => names.set(k, k));
      return names;
    case "month":
      keys.forEach((k) => {
        const parsed = DateTime.fromFormat(k, "yyyy-MM");
        names.set(k, parsed.isValid ? parsed.toFormat("LLL yyyy") : k);
      });
      return names;
    case "category": {
      const rows = await db.category.findMany({
        where: { id: { in: keys }, organizationId },
        select: { id: true, name: true },
      });
      rows.forEach((r) => names.set(r.id, r.name));
      return names;
    }
    case "location": {
      const rows = await db.location.findMany({
        where: { id: { in: keys }, organizationId },
        select: { id: true, name: true },
      });
      rows.forEach((r) => names.set(r.id, r.name));
      return names;
    }
    case "assetModel": {
      const rows = await db.assetModel.findMany({
        where: { id: { in: keys }, organizationId },
        select: { id: true, name: true },
      });
      rows.forEach((r) => names.set(r.id, r.name));
      return names;
    }
    case "kit": {
      const rows = await db.kit.findMany({
        where: { id: { in: keys }, organizationId },
        select: { id: true, name: true },
      });
      rows.forEach((r) => names.set(r.id, r.name));
      return names;
    }
    case "custodian": {
      const teamMemberIds = keys.filter((k) => !k.startsWith("user:"));
      const userIds = keys
        .filter((k) => k.startsWith("user:"))
        .map((k) => k.slice("user:".length));
      const [teamMembers, users] = await Promise.all([
        teamMemberIds.length > 0
          ? db.teamMember.findMany({
              where: { id: { in: teamMemberIds }, organizationId },
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            })
          : [],
        userIds.length > 0
          ? db.user.findMany({
              // Only users who hold a booking in this workspace reach here;
              // the membership join keeps a stray id from naming an outsider.
              where: {
                id: { in: userIds },
                userOrganizations: { some: { organizationId } },
              },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            })
          : [],
      ]);
      teamMembers.forEach((tm) => names.set(tm.id, resolveTeamMemberName(tm)));
      users.forEach((u) =>
        names.set(`user:${u.id}`, resolveUserDisplayName(u))
      );
      return names;
    }
  }
}

/** Formats a measure value for a KPI card. */
function formatMeasureValue(
  measure: BuilderMeasure,
  value: number,
  currency: Currency
): string {
  switch (MEASURE_FORMAT[measure]) {
    case "currency":
      return value > 0 ? formatKpiCurrency(value, currency) : "—";
    case "duration":
      return `${(Math.round(value * 10) / 10).toLocaleString("en-US")} days`;
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

/**
 * Runs a spec and shapes the result for the report components.
 *
 * @param args - See {@link RunBuilderReportArgs}
 * @returns Rows (largest group first), three KPIs, and a bar-chart series
 * @throws {ShelfError} When a query fails
 */
export async function runBuilderReport(
  args: RunBuilderReportArgs
): Promise<BuilderReportResult> {
  const { organizationId, timeframe, timeZone, assetFilter, currency } = args;
  const startTime = performance.now();

  // A custom-field grouping without a verified field falls back to the
  // dataset's first grouping instead of grouping on nothing.
  const spec: BuilderSpec =
    args.spec.groupBy === "customField" && !args.customField
      ? {
          ...args.spec,
          groupBy: DATASET_GROUP_BYS[args.spec.dataset][0],
          customFieldId: null,
        }
      : { ...args.spec, customFieldId: args.customField?.id ?? null };

  try {
    const { grouped, totals } = compileBuilderQueries({
      organizationId,
      spec,
      timeframe,
      timeZone,
      assetFilter,
    });

    const [groupedRows, totalsRows] = await Promise.all([
      db.$queryRaw<GroupedRow[]>(grouped),
      db.$queryRaw<TotalsRow[]>(totals),
    ]);
    const totalsRow: TotalsRow = totalsRows[0] ?? {};

    const truncated = groupedRows.length > BUILDER_MAX_GROUPS;
    const kept = truncated
      ? groupedRows.slice(0, BUILDER_MAX_GROUPS)
      : groupedRows;

    const keys = kept.map((r) => r.key).filter((k): k is string => k !== null);
    const names = await resolveGroupNames(spec.groupBy, keys, organizationId);

    const measures = DATASET_MEASURES[spec.dataset];
    const total = Number(totalsRow[spec.measure] ?? 0);
    const isAverage = AVERAGE_MEASURES.includes(spec.measure);

    const rows: BuilderRow[] = kept.map((r) => {
      const value = Number(r[spec.measure] ?? 0);
      const measureValues: Partial<Record<BuilderMeasure, number>> = {};
      for (const m of measures) measureValues[m] = Number(r[m] ?? 0);
      return {
        id: r.key ?? NO_GROUP_KEY,
        groupName:
          r.key === null
            ? NO_GROUP_LABEL[spec.groupBy]
            : names.get(r.key) ?? "Unknown",
        value,
        share:
          !isAverage && total > 0
            ? Math.round((value / total) * 1000) / 10
            : null,
        measures: measureValues,
      };
    });

    const groupCount = Number(groupedRows[0]?.groupCount ?? 0);
    const top = rows[0];
    // A custom-field grouping is named after the field ("Condition groups").
    const groupLabel =
      spec.groupBy === "customField" && args.customField
        ? args.customField.name
        : GROUP_BY_LABELS[spec.groupBy];
    const kpis: ReportKpi[] = [
      {
        id: `total_${spec.measure}`,
        label: MEASURE_LABELS[spec.measure],
        value: formatMeasureValue(spec.measure, total, currency),
        rawValue: total,
        format:
          MEASURE_FORMAT[spec.measure] === "currency" ? "currency" : "number",
        delta: null,
        deltaType: "neutral",
        description: isAverage
          ? "Average across everything counted"
          : "Across everything counted, before grouping",
      },
      {
        id: "groups",
        label: `${groupLabel} groups`,
        value: groupCount.toLocaleString("en-US"),
        rawValue: groupCount,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "top_group",
        label: "Largest group",
        value: top
          ? top.groupName.length > 24
            ? `${top.groupName.slice(0, 24)}...`
            : top.groupName
          : "—",
        rawValue: top?.value ?? 0,
        format: "number",
        delta:
          top?.share !== null && top?.share !== undefined
            ? `${top.share}%`
            : null,
        deltaType: "neutral",
        description: top
          ? `${formatMeasureValue(spec.measure, top.value, currency)}`
          : undefined,
      },
    ];

    const chartSeries: ChartSeries[] =
      spec.groupBy === "none" || rows.length === 0
        ? []
        : [
            {
              id: spec.measure,
              name: MEASURE_LABELS[spec.measure],
              data: [
                ...rows.slice(0, BUILDER_CHART_GROUPS).map((r) => ({
                  date: r.groupName,
                  value: Math.round(r.value * 100) / 100,
                })),
                ...(rows.length > BUILDER_CHART_GROUPS && !isAverage
                  ? [
                      {
                        date: "Other",
                        value:
                          Math.round(
                            rows
                              .slice(BUILDER_CHART_GROUPS)
                              .reduce((sum, r) => sum + r.value, 0) * 100
                          ) / 100,
                      },
                    ]
                  : []),
              ],
            },
          ];

    return {
      spec,
      rows,
      kpis,
      chartSeries,
      totalGroups: groupCount,
      truncated,
      computedMs: Math.round(performance.now() - startTime),
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to run the custom report",
      additionalData: { organizationId, spec, timeframe: timeframe.preset },
      label,
    });
  }
}
