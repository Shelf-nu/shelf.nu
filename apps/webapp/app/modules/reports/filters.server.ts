/**
 * Report filters: request → verified, labelled, query-ready.
 *
 * Two jobs, both scoped to the workspace and to the filters a report declares
 * in the registry:
 *
 * - {@link resolveReportFilters} turns the query string into the predicate the
 *   report functions consume, dropping ids that do not belong to the
 *   workspace (an id from another workspace must filter nothing, never leak)
 *   and labelling each active filter for the chips on screen. The report
 *   page, the CSV export and the PDF export all call this, so the three
 *   surfaces cannot disagree about which filters are in effect.
 * - {@link loadReportFilterOptions} loads the pick-lists the filter bar
 *   renders: the first page of categories, locations, custodians and asset
 *   models (the dropdowns search the rest through `/api/model-filters`), the
 *   status choices, and the custom fields with the values they hold.
 *
 * @see {@link file://./filter-params.ts} the URL grammar
 * @see {@link file://./asset-filter.ts} the predicate builder
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 */

import type { BookingStatus } from "@prisma/client";
import { AssetStatus, type CustomFieldType, Prisma } from "@prisma/client";
import { ASSET_STATUS_LABELS, BOOKING_STATUS_LABELS } from "@shelf/labels";
import { db } from "~/database/db.server";
import { MEASURABLE_BOOKING_STATUSES } from "~/modules/booking/lateness";
import { ShelfError } from "~/utils/error";
import { resolveTeamMemberName } from "~/utils/user";
import {
  BOOLEAN_FILTER_VALUES,
  buildReportAssetFilter,
  isReportFilterableCustomFieldType,
  type ReportAssetFilter,
  type ResolvedCustomFieldValue,
} from "./asset-filter";
import {
  encodeCustomFieldParam,
  hasActiveReportFilters,
  parseReportFilterParams,
  REPORT_FILTER_PARAM,
  WITHOUT_LOCATION_ID,
  type ReportFilterParams,
} from "./filter-params";
import type {
  ActiveReportFilter,
  FilterType,
  ReportCustomFieldOption,
  ReportDefinition,
  ReportFilterOptions,
  ReportStatusOption,
} from "./types";

/** The query-ready result of {@link resolveReportFilters}. */
export interface ResolvedReportFilters {
  /** Parsed params, narrowed to the filter types the report declares. */
  params: ReportFilterParams;
  /** Predicate for asset-based reports, in Prisma and raw-SQL form. */
  assetFilter: ReportAssetFilter;
  /** Booking statuses for booking reports; empty when none chosen. */
  bookingStatuses: BookingStatus[];
  /** Verified `TeamMember` id when the report declares a custodian filter. */
  teamMemberId: string | null;
  /** Asset id when the report declares an asset filter (not verified here). */
  assetId: string | null;
  /** Labelled chips, in URL order. */
  active: ActiveReportFilter[];
}

/** How many entries a dropdown receives up front; it searches for the rest. */
const PICK_LIST_PAGE_SIZE = 25;

/** Distinct TEXT values loaded per custom field before the bar offers typing. */
const CUSTOM_FIELD_VALUES_LIMIT = 200;

const label = "Report" as const;

/** Whether the registry declares `type` for this report. */
function declares(reportDef: ReportDefinition, type: FilterType): boolean {
  return reportDef.filters.some((f) => f.type === type);
}

/**
 * Status choices differ by what the report counts: booking reports filter
 * bookings by the statuses compliance can measure, asset reports filter
 * assets by their own status.
 */
function statusOptionsFor(reportDef: ReportDefinition): ReportStatusOption[] {
  if (!declares(reportDef, "status")) return [];
  if (reportDef.category === "bookings") {
    return MEASURABLE_BOOKING_STATUSES.map((status) => ({
      value: status,
      label: BOOKING_STATUS_LABELS[status as BookingStatus],
    }));
  }
  return Object.values(AssetStatus).map((status) => ({
    value: status,
    label: ASSET_STATUS_LABELS[status],
  }));
}

/** Keeps only the statuses that are valid for the report's status kind. */
function narrowStatuses(
  reportDef: ReportDefinition,
  statuses: string[]
): { assetStatuses: AssetStatus[]; bookingStatuses: BookingStatus[] } {
  if (!declares(reportDef, "status") || statuses.length === 0) {
    return { assetStatuses: [], bookingStatuses: [] };
  }
  if (reportDef.category === "bookings") {
    const allowed = new Set<string>(MEASURABLE_BOOKING_STATUSES);
    return {
      assetStatuses: [],
      bookingStatuses: statuses.filter((s): s is BookingStatus =>
        allowed.has(s)
      ),
    };
  }
  const allowed = new Set<string>(Object.values(AssetStatus));
  return {
    assetStatuses: statuses.filter((s): s is AssetStatus => allowed.has(s)),
    bookingStatuses: [],
  };
}

/** Display text for a custom-field chip value. */
function customFieldValueLabel(type: CustomFieldType, value: string): string {
  if (type !== "BOOLEAN") return value;
  return value.trim().toLowerCase() === BOOLEAN_FILTER_VALUES.yes ||
    value.trim().toLowerCase() === "true"
    ? "Yes"
    : "No";
}

/**
 * Verifies the requested filter ids against the workspace and builds the
 * predicate plus the chips.
 *
 * @param args.organizationId - The current workspace
 * @param args.searchParams - The request's query string
 * @param args.reportDef - The report being run; undeclared filters are ignored
 * @returns Query-ready filters
 * @throws {ShelfError} When a lookup query fails
 */
export async function resolveReportFilters({
  organizationId,
  searchParams,
  reportDef,
}: {
  organizationId: string;
  searchParams: URLSearchParams;
  reportDef: ReportDefinition;
}): Promise<ResolvedReportFilters> {
  const raw = parseReportFilterParams(searchParams);

  // Narrow to what this report declares before any lookup runs.
  const params: ReportFilterParams = {
    categoryIds: declares(reportDef, "category") ? raw.categoryIds : [],
    locationIds: declares(reportDef, "location") ? raw.locationIds : [],
    teamMemberId: declares(reportDef, "team_member") ? raw.teamMemberId : null,
    statuses: declares(reportDef, "status") ? raw.statuses : [],
    assetModelIds: declares(reportDef, "asset_model") ? raw.assetModelIds : [],
    assetId: declares(reportDef, "asset") ? raw.assetId : null,
    customFieldValues: declares(reportDef, "custom_field")
      ? raw.customFieldValues
      : [],
  };

  const { assetStatuses, bookingStatuses } = narrowStatuses(
    reportDef,
    params.statuses
  );

  if (!hasActiveReportFilters(params)) {
    return {
      params,
      assetFilter: buildReportAssetFilter({}),
      bookingStatuses: [],
      teamMemberId: null,
      assetId: null,
      active: [],
    };
  }

  try {
    const realLocationIds = params.locationIds.filter(
      (id) => id !== WITHOUT_LOCATION_ID
    );
    const customFieldIds = params.customFieldValues.map((f) => f.customFieldId);

    const [categories, locations, assetModels, teamMember, customFields] =
      await Promise.all([
        params.categoryIds.length > 0
          ? db.category.findMany({
              where: { id: { in: params.categoryIds }, organizationId },
              select: { id: true, name: true },
            })
          : [],
        realLocationIds.length > 0
          ? db.location.findMany({
              where: { id: { in: realLocationIds }, organizationId },
              select: { id: true, name: true },
            })
          : [],
        params.assetModelIds.length > 0
          ? db.assetModel.findMany({
              where: { id: { in: params.assetModelIds }, organizationId },
              select: { id: true, name: true },
            })
          : [],
        params.teamMemberId
          ? db.teamMember.findFirst({
              where: { id: params.teamMemberId, organizationId },
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            })
          : null,
        customFieldIds.length > 0
          ? db.customField.findMany({
              where: {
                id: { in: customFieldIds },
                organizationId,
                deletedAt: null,
              },
              select: { id: true, name: true, type: true },
            })
          : [],
      ]);

    const categoryById = new Map(categories.map((c) => [c.id, c.name]));
    const locationById = new Map(locations.map((l) => [l.id, l.name]));
    const assetModelById = new Map(assetModels.map((m) => [m.id, m.name]));
    const customFieldById = new Map(customFields.map((f) => [f.id, f]));

    // Only ids that exist in this workspace survive; the chips mirror that.
    const categoryIds = params.categoryIds.filter((id) => categoryById.has(id));
    const locationIds = params.locationIds.filter(
      (id) => id === WITHOUT_LOCATION_ID || locationById.has(id)
    );
    const assetModelIds = params.assetModelIds.filter((id) =>
      assetModelById.has(id)
    );
    const customFieldValues: ResolvedCustomFieldValue[] = [];
    for (const filter of params.customFieldValues) {
      const field = customFieldById.get(filter.customFieldId);
      if (!field || !isReportFilterableCustomFieldType(field.type)) continue;
      customFieldValues.push({ ...filter, type: field.type });
    }

    const active: ActiveReportFilter[] = [];
    for (const id of categoryIds) {
      active.push({
        type: "category",
        param: REPORT_FILTER_PARAM.category,
        value: id,
        label: `Category: ${categoryById.get(id)}`,
      });
    }
    for (const id of locationIds) {
      active.push({
        type: "location",
        param: REPORT_FILTER_PARAM.location,
        value: id,
        label: `Location: ${
          id === WITHOUT_LOCATION_ID ? "Without location" : locationById.get(id)
        }`,
      });
    }
    if (teamMember) {
      active.push({
        type: "team_member",
        param: REPORT_FILTER_PARAM.teamMember,
        value: teamMember.id,
        label: `Custodian: ${resolveTeamMemberName(teamMember)}`,
      });
    }
    const statusOptions = statusOptionsFor(reportDef);
    for (const status of [...assetStatuses, ...bookingStatuses]) {
      active.push({
        type: "status",
        param: REPORT_FILTER_PARAM.status,
        value: status,
        label: `Status: ${
          statusOptions.find((o) => o.value === status)?.label ?? status
        }`,
      });
    }
    for (const id of assetModelIds) {
      active.push({
        type: "asset_model",
        param: REPORT_FILTER_PARAM.assetModel,
        value: id,
        label: `Model: ${assetModelById.get(id)}`,
      });
    }
    for (const filter of customFieldValues) {
      const field = customFieldById.get(filter.customFieldId)!;
      active.push({
        type: "custom_field",
        param: REPORT_FILTER_PARAM.customField,
        value: encodeCustomFieldParam(filter),
        label: `${field.name}: ${customFieldValueLabel(
          filter.type,
          filter.value
        )}`,
      });
    }

    return {
      params: {
        ...params,
        categoryIds,
        locationIds,
        assetModelIds,
        teamMemberId: teamMember?.id ?? null,
        customFieldValues,
      },
      assetFilter: buildReportAssetFilter({
        categoryIds,
        locationIds,
        assetModelIds,
        statuses: assetStatuses,
        customFieldValues,
      }),
      bookingStatuses,
      teamMemberId: teamMember?.id ?? null,
      assetId: params.assetId,
      active,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to resolve the report filters",
      additionalData: { organizationId, reportId: reportDef.id },
      label,
    });
  }
}

/** A distinct stored value of a TEXT custom field, with how often it occurs. */
type CustomFieldValueRow = {
  customFieldId: string;
  value: string;
  rowNumber: number;
};

/**
 * Loads the distinct `raw` values of the given TEXT fields, most frequent
 * first, one row past the limit per field so the caller can tell that more
 * exist. Scoped through `Asset.organizationId`: a field id belongs to one
 * workspace already, and the join keeps it that way if that ever changes.
 */
async function loadTextCustomFieldValues(
  organizationId: string,
  customFieldIds: string[]
): Promise<Map<string, { values: string[]; hasMore: boolean }>> {
  const result = new Map<string, { values: string[]; hasMore: boolean }>();
  if (customFieldIds.length === 0) return result;

  const rows = await db.$queryRaw<CustomFieldValueRow[]>(Prisma.sql`
    SELECT "customFieldId", value, "rowNumber"
    FROM (
      SELECT
        v."customFieldId" AS "customFieldId",
        v.value->>'raw' AS value,
        ROW_NUMBER() OVER (
          PARTITION BY v."customFieldId"
          ORDER BY COUNT(*) DESC, v.value->>'raw' ASC
        )::int AS "rowNumber"
      FROM "AssetCustomFieldValue" v
      JOIN "Asset" a ON a.id = v."assetId"
      WHERE a."organizationId" = ${organizationId}
        AND v."customFieldId" IN (${Prisma.join(customFieldIds)})
        AND NULLIF(TRIM(v.value->>'raw'), '') IS NOT NULL
      GROUP BY v."customFieldId", v.value->>'raw'
    ) ranked
    WHERE "rowNumber" <= ${CUSTOM_FIELD_VALUES_LIMIT + 1}
    ORDER BY "customFieldId", "rowNumber"
  `);

  for (const row of rows) {
    const entry = result.get(row.customFieldId) ?? {
      values: [],
      hasMore: false,
    };
    if (row.rowNumber > CUSTOM_FIELD_VALUES_LIMIT) {
      entry.hasMore = true;
    } else {
      entry.values.push(row.value);
    }
    result.set(row.customFieldId, entry);
  }
  return result;
}

/**
 * Loads the pick-lists for the filters a report declares.
 *
 * @param args.organizationId - The current workspace
 * @param args.reportDef - The report whose filter bar is being rendered
 * @returns Lists for the declared filter types; empty lists for the rest
 * @throws {ShelfError} When a lookup query fails
 */
export async function loadReportFilterOptions({
  organizationId,
  reportDef,
}: {
  organizationId: string;
  reportDef: ReportDefinition;
}): Promise<ReportFilterOptions> {
  const empty: ReportFilterOptions = {
    categories: [],
    totalCategories: 0,
    locations: [],
    totalLocations: 0,
    teamMembers: [],
    totalTeamMembers: 0,
    assetModels: [],
    totalAssetModels: 0,
    customFields: [],
    statuses: statusOptionsFor(reportDef),
  };

  try {
    const [
      categories,
      totalCategories,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
      assetModels,
      totalAssetModels,
      customFieldDefs,
    ] = await Promise.all([
      declares(reportDef, "category")
        ? db.category.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
            take: PICK_LIST_PAGE_SIZE,
            select: { id: true, name: true, color: true },
          })
        : [],
      declares(reportDef, "category")
        ? db.category.count({ where: { organizationId } })
        : 0,
      declares(reportDef, "location")
        ? db.location.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
            take: PICK_LIST_PAGE_SIZE,
            select: { id: true, name: true },
          })
        : [],
      declares(reportDef, "location")
        ? db.location.count({ where: { organizationId } })
        : 0,
      declares(reportDef, "team_member")
        ? db.teamMember.findMany({
            where: { organizationId, deletedAt: null },
            orderBy: { name: "asc" },
            take: PICK_LIST_PAGE_SIZE,
            select: {
              id: true,
              name: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  email: true,
                },
              },
            },
          })
        : [],
      declares(reportDef, "team_member")
        ? db.teamMember.count({ where: { organizationId, deletedAt: null } })
        : 0,
      declares(reportDef, "asset_model")
        ? db.assetModel.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
            take: PICK_LIST_PAGE_SIZE,
            select: { id: true, name: true },
          })
        : [],
      declares(reportDef, "asset_model")
        ? db.assetModel.count({ where: { organizationId } })
        : 0,
      declares(reportDef, "custom_field")
        ? db.customField.findMany({
            where: { organizationId, active: true, deletedAt: null },
            orderBy: { name: "asc" },
            select: { id: true, name: true, type: true, options: true },
          })
        : [],
    ]);

    const filterableFields = customFieldDefs.filter((f) =>
      isReportFilterableCustomFieldType(f.type)
    );
    const textValues = await loadTextCustomFieldValues(
      organizationId,
      filterableFields.filter((f) => f.type === "TEXT").map((f) => f.id)
    );

    const customFields: ReportCustomFieldOption[] = filterableFields.map(
      (field) => {
        if (field.type === "OPTION") {
          return {
            id: field.id,
            name: field.name,
            type: field.type,
            values: field.options,
            hasMoreValues: false,
          };
        }
        if (field.type === "BOOLEAN") {
          return {
            id: field.id,
            name: field.name,
            type: field.type,
            values: [BOOLEAN_FILTER_VALUES.yes, BOOLEAN_FILTER_VALUES.no],
            hasMoreValues: false,
          };
        }
        const loaded = textValues.get(field.id);
        return {
          id: field.id,
          name: field.name,
          type: field.type,
          values: loaded?.values ?? [],
          hasMoreValues: loaded?.hasMore ?? false,
        };
      }
    );

    return {
      ...empty,
      categories,
      totalCategories,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
      assetModels,
      totalAssetModels,
      customFields,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to load the report filter options",
      additionalData: { organizationId, reportId: reportDef.id },
      label,
    });
  }
}
