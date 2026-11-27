/**
 * Report builder specification.
 *
 * A custom report is one closed choice from each of three lists: the data to
 * count (assets, bookings or custody), what to group it by, and what to
 * measure. Every value is a whitelisted key; the only free text is a custom
 * field id, which the server verifies against the workspace before it reaches
 * SQL. The spec travels in the URL, so a built report is a shareable link and
 * the CSV export reads exactly what the page shows.
 *
 * Pure module: no database, no React, safe to import from the client bundle.
 * The compiler that turns a spec into SQL lives in `compile.server.ts`.
 *
 * @see {@link file://./compile.server.ts}
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import type { ReportDefinition, ReportKpi } from "../types";

/** The tables a custom report can count. */
export const BUILDER_DATASETS = ["assets", "bookings", "custody"] as const;
/** One of the tables a custom report can count. */
export type BuilderDataset = (typeof BUILDER_DATASETS)[number];

/** Every grouping the builder knows; each dataset allows a subset. */
export const BUILDER_GROUP_BYS = [
  "none",
  "category",
  "location",
  "status",
  "assetModel",
  "kit",
  "customField",
  "custodian",
  "month",
] as const;
/** One grouping a custom report can use. */
export type BuilderGroupBy = (typeof BUILDER_GROUP_BYS)[number];

/** Every measure the builder knows; each dataset computes a subset. */
export const BUILDER_MEASURES = [
  "assetCount",
  "units",
  "totalValue",
  "bookingCount",
  "assetsBooked",
  "unitsBooked",
  "daysBooked",
  "custodyCount",
  "custodyUnits",
  "avgDaysInCustody",
] as const;
/** One measure a custom report can compute. */
export type BuilderMeasure = (typeof BUILDER_MEASURES)[number];

/** Groupings available per dataset, in menu order. */
export const DATASET_GROUP_BYS: Record<BuilderDataset, BuilderGroupBy[]> = {
  assets: [
    "category",
    "location",
    "status",
    "assetModel",
    "kit",
    "customField",
  ],
  bookings: [
    "category",
    "location",
    "assetModel",
    "kit",
    "customField",
    "custodian",
    "month",
  ],
  custody: [
    "category",
    "location",
    "assetModel",
    "kit",
    "customField",
    "custodian",
  ],
};

/** Measures computed per dataset, in menu order; the first is the default. */
export const DATASET_MEASURES: Record<BuilderDataset, BuilderMeasure[]> = {
  assets: ["assetCount", "units", "totalValue"],
  bookings: ["bookingCount", "assetsBooked", "unitsBooked", "daysBooked"],
  custody: ["custodyCount", "custodyUnits", "totalValue", "avgDaysInCustody"],
};

/** Menu labels for datasets. */
export const DATASET_LABELS: Record<BuilderDataset, string> = {
  assets: "Assets",
  bookings: "Bookings",
  custody: "Custody",
};

/** One-line description per dataset, shown under the menu. */
export const DATASET_DESCRIPTIONS: Record<BuilderDataset, string> = {
  assets: "Your inventory as it is now",
  bookings: "Bookings that overlap the chosen period",
  custody: "Assets in someone's custody right now",
};

/** Menu labels for groupings. */
export const GROUP_BY_LABELS: Record<BuilderGroupBy, string> = {
  none: "Nothing (one total)",
  category: "Category",
  location: "Location",
  status: "Status",
  assetModel: "Asset model",
  kit: "Kit",
  customField: "Custom field",
  custodian: "Custodian",
  month: "Month",
};

/** Menu labels for measures. */
export const MEASURE_LABELS: Record<BuilderMeasure, string> = {
  assetCount: "Number of assets",
  units: "Units (quantity)",
  totalValue: "Total value",
  bookingCount: "Number of bookings",
  assetsBooked: "Assets booked",
  unitsBooked: "Units booked",
  daysBooked: "Days booked",
  custodyCount: "Assets in custody",
  custodyUnits: "Units in custody",
  avgDaysInCustody: "Average days in custody",
};

/** How a measure's number is displayed. */
export const MEASURE_FORMAT: Record<BuilderMeasure, ReportKpi["format"]> = {
  assetCount: "number",
  units: "number",
  totalValue: "currency",
  bookingCount: "number",
  assetsBooked: "number",
  unitsBooked: "number",
  daysBooked: "duration",
  custodyCount: "number",
  custodyUnits: "number",
  avgDaysInCustody: "duration",
};

/**
 * Measures that count distinct things. Their per-group values cannot be
 * summed into a total when a thing can sit in several groups (an asset at two
 * locations), so the compiler runs a separate ungrouped count for the KPI.
 */
export const DISTINCT_MEASURES: readonly BuilderMeasure[] = [
  "assetCount",
  "bookingCount",
  "assetsBooked",
  "custodyCount",
];

/** Measures that average rather than add up; their KPI total is an average too. */
export const AVERAGE_MEASURES: readonly BuilderMeasure[] = ["avgDaysInCustody"];

/** The chosen report. */
export interface BuilderSpec {
  dataset: BuilderDataset;
  groupBy: BuilderGroupBy;
  /** Set only when `groupBy` is `customField`; verified server-side. */
  customFieldId: string | null;
  measure: BuilderMeasure;
}

/** Query-string keys the builder bar writes. */
export const BUILDER_SPEC_PARAM = {
  dataset: "dataset",
  /** `category`, `location`, ... or `customField:<customFieldId>`. */
  groupBy: "groupBy",
  measure: "measure",
} as const;

/** The report a fresh `/reports/builder` shows. */
export const DEFAULT_BUILDER_SPEC: BuilderSpec = {
  dataset: "assets",
  groupBy: "category",
  customFieldId: null,
  measure: "assetCount",
};

const CUSTOM_FIELD_GROUP_PREFIX = "customField:";

function isDataset(value: string): value is BuilderDataset {
  return (BUILDER_DATASETS as readonly string[]).includes(value);
}

function isGroupBy(value: string): value is BuilderGroupBy {
  return (BUILDER_GROUP_BYS as readonly string[]).includes(value);
}

function isMeasure(value: string): value is BuilderMeasure {
  return (BUILDER_MEASURES as readonly string[]).includes(value);
}

/** Whether a dataset is counted inside a period (only bookings are). */
export function datasetUsesTimeframe(dataset: BuilderDataset): boolean {
  return dataset === "bookings";
}

/**
 * Reads the spec from a query string. Anything missing, unknown or not
 * allowed for the chosen dataset falls back rather than failing, so a stale
 * link still renders a report.
 *
 * @param searchParams - The request's query string
 * @returns A valid spec
 */
export function parseBuilderSpec(searchParams: URLSearchParams): BuilderSpec {
  const rawDataset = searchParams.get(BUILDER_SPEC_PARAM.dataset) ?? "";
  const dataset: BuilderDataset = isDataset(rawDataset)
    ? rawDataset
    : DEFAULT_BUILDER_SPEC.dataset;

  const rawGroupBy = searchParams.get(BUILDER_SPEC_PARAM.groupBy) ?? "";
  let groupBy: BuilderGroupBy;
  let customFieldId: string | null = null;
  if (rawGroupBy.startsWith(CUSTOM_FIELD_GROUP_PREFIX)) {
    const id = rawGroupBy.slice(CUSTOM_FIELD_GROUP_PREFIX.length).trim();
    groupBy = id ? "customField" : DATASET_GROUP_BYS[dataset][0];
    customFieldId = id || null;
  } else {
    groupBy = isGroupBy(rawGroupBy)
      ? rawGroupBy
      : DATASET_GROUP_BYS[dataset][0];
  }
  if (groupBy !== "none" && !DATASET_GROUP_BYS[dataset].includes(groupBy)) {
    groupBy = DATASET_GROUP_BYS[dataset][0];
    customFieldId = null;
  }

  const rawMeasure = searchParams.get(BUILDER_SPEC_PARAM.measure) ?? "";
  const measure: BuilderMeasure =
    isMeasure(rawMeasure) && DATASET_MEASURES[dataset].includes(rawMeasure)
      ? rawMeasure
      : DATASET_MEASURES[dataset][0];

  return { dataset, groupBy, customFieldId, measure };
}

/**
 * Serialises a group-by choice for the `groupBy` query parameter.
 *
 * @param groupBy - The grouping
 * @param customFieldId - Required when `groupBy` is `customField`
 */
export function encodeGroupBy(
  groupBy: BuilderGroupBy,
  customFieldId: string | null
): string {
  return groupBy === "customField" && customFieldId
    ? `${CUSTOM_FIELD_GROUP_PREFIX}${customFieldId}`
    : groupBy;
}

/**
 * Writes a spec into a copy of `params`, keeping every other key (filters,
 * timeframe) and resetting paging.
 */
export function writeBuilderSpec(
  params: URLSearchParams,
  spec: BuilderSpec
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(BUILDER_SPEC_PARAM.dataset, spec.dataset);
  next.set(
    BUILDER_SPEC_PARAM.groupBy,
    encodeGroupBy(spec.groupBy, spec.customFieldId)
  );
  next.set(BUILDER_SPEC_PARAM.measure, spec.measure);
  next.delete("page");
  return next;
}

/**
 * Applies a dataset change: the grouping and measure are kept when the new
 * dataset supports them and reset to its defaults otherwise.
 */
export function withDataset(
  spec: BuilderSpec,
  dataset: BuilderDataset
): BuilderSpec {
  const groupBy =
    spec.groupBy === "none" || DATASET_GROUP_BYS[dataset].includes(spec.groupBy)
      ? spec.groupBy
      : DATASET_GROUP_BYS[dataset][0];
  return {
    dataset,
    groupBy,
    customFieldId: groupBy === "customField" ? spec.customFieldId : null,
    measure: DATASET_MEASURES[dataset].includes(spec.measure)
      ? spec.measure
      : DATASET_MEASURES[dataset][0],
  };
}

/**
 * The filters the builder offers. Shaped as a report definition so the shared
 * filter resolver, pick-list loader and filter bar work unchanged. The
 * category `overview` makes the status filter read asset statuses.
 */
export const BUILDER_REPORT_DEF: ReportDefinition = {
  id: "builder",
  title: "Report builder",
  description:
    "Pick the data, group it, choose a measure and filter it your way.",
  category: "overview",
  icon: "SlidersHorizontal",
  enabled: true,
  filters: [
    { type: "category", label: "Category", multi: true },
    { type: "location", label: "Location", multi: true },
    { type: "status", label: "Status", multi: true },
    { type: "asset_model", label: "Asset model", multi: true },
    { type: "custom_field", label: "Custom field", multi: true },
  ],
  hasChart: true,
  exportable: true,
};

/** One group in the result. Every dataset measure is carried; `value` is the chosen one. */
export interface BuilderRow {
  /** Group key: an entity id, a status, a month `YYYY-MM`, raw text, or `none`. */
  id: string;
  /** Display name resolved server-side. */
  groupName: string;
  /** The chosen measure for this group. */
  value: number;
  /** This group's share of the total, in percent; null when not meaningful. */
  share: number | null;
  /** Every measure the dataset computes, for the table and the CSV. */
  measures: Partial<Record<BuilderMeasure, number>>;
}

/** How many groups a result may hold; larger tails are truncated. */
export const BUILDER_MAX_GROUPS = 500;

/** How many groups the chart draws before the rest fold into "Other". */
export const BUILDER_CHART_GROUPS = 20;
