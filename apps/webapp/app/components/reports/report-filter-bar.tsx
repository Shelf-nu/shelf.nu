/**
 * @file Report filter bar.
 *
 * Renders every control a report declares in the registry:
 *   - The shared `TimeframePicker` + `TimeframeRangeIndicator` for
 *     time-based reports, or the `IdleThresholdSelector` for Idle Assets.
 *   - One control per declared filter type: the shared `DynamicDropdown`
 *     for categories, locations, custodians and asset models (it reads its
 *     pick-lists from the route's loader data and writes `<model>=<id>`
 *     query parameters), a checkbox popover for statuses, and the two-step
 *     custom-field picker.
 *   - A chip row of the filters in effect, each removable, plus "Clear all".
 *
 * All state lives in the URL, so the CSV and PDF exports, which forward the
 * page's query string, always see the same filters as the screen. A loading
 * spinner is shown while a navigation is in flight.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://./../../modules/reports/filter-params.ts}
 * @see {@link file://./filters/custom-field-filter.tsx}
 */

import { useCallback } from "react";

import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import { useSearchParams } from "~/hooks/search-params";
import { WITHOUT_LOCATION_ID } from "~/modules/reports/filter-params";
import type {
  ActiveReportFilter,
  FilterType,
  ReportFilterConfig,
  ReportFilterOptions,
  ResolvedTimeframe,
  TimeframePreset,
} from "~/modules/reports/types";

import { getIntParam } from "~/utils/search-params-number";
import { resolveTeamMemberName } from "~/utils/user";
import { ActiveFilterChips } from "./filters/active-filter-chips";
import { CustomFieldFilter } from "./filters/custom-field-filter";
import { StatusFilterDropdown } from "./filters/status-filter-dropdown";
import { IdleThresholdSelector } from "./idle-threshold-selector";
import { TimeframePicker } from "./timeframe-picker";
import { TimeframeRangeIndicator } from "./timeframe-range-indicator";

/** Props for {@link ReportFilterBar}. */
type Props = {
  /** Current report id (drives which time control is shown). */
  reportId: string;
  /** Resolved timeframe coming from the loader. */
  timeframe: ResolvedTimeframe;
  /** Whether a navigation (filter change, pagination, etc.) is in
   *  flight — used to disable controls and show a spinner. */
  isLoading: boolean;
  /** The filters the registry declares for this report. */
  filterConfigs: ReportFilterConfig[];
  /** Filters currently applied, labelled by the loader. */
  activeFilters: ActiveReportFilter[];
  /** Pick-lists for the declared filters. */
  filterOptions: ReportFilterOptions;
};

/**
 * Filter types this bar can render. Pinned by a test against the registry so
 * a report cannot declare a filter that silently never appears on screen.
 * `asset` and `booking` are URL-only today: no picker exists for them.
 */
export const RENDERED_FILTER_TYPES: readonly FilterType[] = [
  "category",
  "location",
  "team_member",
  "status",
  "asset_model",
  "custom_field",
];

/** Filter types that are URL-only and produce no control. */
export const URL_ONLY_FILTER_TYPES: readonly FilterType[] = [
  "asset",
  "booking",
];

/** Classes for the shared dropdown triggers so all controls read as one set. */
const TRIGGER_CLASSES =
  "rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50";

/**
 * Renders the filter row above the report content: the time control (when
 * the report has one), one control per declared filter, and the active
 * chips. Returns `null` only when a report has neither.
 */
export function ReportFilterBar({
  reportId,
  timeframe,
  isLoading,
  filterConfigs,
  activeFilters,
  filterOptions,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const handleIdleThresholdChange = useCallback(
    (days: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("days", days.toString());
      params.delete("page"); // Reset to page 1 when filter changes
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const hasTimeframe = showTimeframePicker(reportId);
  const hasIdleThreshold = reportId === "idle-assets";
  const declared = new Set(filterConfigs.map((f) => f.type));
  const renderedConfigs = filterConfigs.filter((f) =>
    RENDERED_FILTER_TYPES.includes(f.type)
  );

  if (!hasTimeframe && !hasIdleThreshold && renderedConfigs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-gray-200 bg-white px-4 py-3">
      {hasTimeframe || hasIdleThreshold ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {hasTimeframe ? (
              <>
                {/* Let the picker own URL serialization (syncToUrl defaults true): its
                    toZonedBoundaryISO path anchors the custom range at pref-tz
                    start/end-of-day. A caller that serialized the resolved instants
                    itself would double-shift the window for non-UTC users. */}
                <TimeframePicker
                  value={timeframe}
                  excludePresets={getExcludedPresets(reportId)}
                  disabled={isLoading}
                />
                <TimeframeRangeIndicator timeframe={timeframe} />
              </>
            ) : null}
            {hasIdleThreshold ? (
              <IdleThresholdSelector
                // Same floor the loader applies, so the selector shows the threshold
                // the report actually ran with.
                value={getIntParam(searchParams, "days", 30, { min: 1 })}
                onChange={handleIdleThresholdChange}
                disabled={isLoading}
              />
            ) : null}
          </div>
          {isLoading ? <FilterLoadingIndicator /> : null}
        </div>
      ) : null}

      {renderedConfigs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Filter by</span>
          {declared.has("category") ? (
            <div className="flex-none">
              <DynamicDropdown
                trigger={<DropdownTriggerLabel label="Category" />}
                triggerWrapperClassName={TRIGGER_CLASSES}
                model={{ name: "category", queryKey: "name" }}
                label="Filter by category"
                placeholder="Search categories"
                initialDataKey="categories"
                countKey="totalCategories"
                selectionMode={multiFor(filterConfigs, "category")}
              />
            </div>
          ) : null}
          {declared.has("location") ? (
            <div className="flex-none">
              <DynamicDropdown
                trigger={<DropdownTriggerLabel label="Location" />}
                triggerWrapperClassName={TRIGGER_CLASSES}
                model={{ name: "location", queryKey: "name" }}
                label="Filter by location"
                placeholder="Search locations"
                initialDataKey="locations"
                countKey="totalLocations"
                selectionMode={multiFor(filterConfigs, "location")}
                withoutValueItem={{
                  id: WITHOUT_LOCATION_ID,
                  name: "Without location",
                }}
              />
            </div>
          ) : null}
          {declared.has("team_member") ? (
            <div className="flex-none">
              <DynamicDropdown
                trigger={<DropdownTriggerLabel label="Custodian" />}
                triggerWrapperClassName={TRIGGER_CLASSES}
                model={{
                  name: "teamMember",
                  queryKey: "name",
                  deletedAt: null,
                  // A read FILTER — the workspace custody override governs.
                  custodyPurpose: "custody-filter",
                }}
                renderItem={(item) => resolveTeamMemberName(item, true)}
                label="Filter by custodian"
                placeholder="Search team members"
                initialDataKey="teamMembers"
                countKey="totalTeamMembers"
                selectionMode={multiFor(filterConfigs, "team_member")}
              />
            </div>
          ) : null}
          {declared.has("status") ? (
            <StatusFilterDropdown
              options={filterOptions.statuses}
              disabled={isLoading}
            />
          ) : null}
          {declared.has("asset_model") ? (
            <div className="flex-none">
              <DynamicDropdown
                trigger={<DropdownTriggerLabel label="Asset model" />}
                triggerWrapperClassName={TRIGGER_CLASSES}
                model={{ name: "assetModel", queryKey: "name" }}
                label="Filter by asset model"
                placeholder="Search asset models"
                initialDataKey="assetModels"
                countKey="totalAssetModels"
                selectionMode={multiFor(filterConfigs, "asset_model")}
              />
            </div>
          ) : null}
          {declared.has("custom_field") ? (
            <CustomFieldFilter
              customFields={filterOptions.customFields}
              disabled={isLoading}
            />
          ) : null}
          {!hasTimeframe && !hasIdleThreshold && isLoading ? (
            <FilterLoadingIndicator />
          ) : null}
        </div>
      ) : null}

      <ActiveFilterChips filters={activeFilters} disabled={isLoading} />
    </div>
  );
}

/**
 * The shared dropdown writes one query value per pick in `append` mode and
 * replaces the value in `set` mode; the registry's `multi` flag decides.
 */
function multiFor(
  configs: ReportFilterConfig[],
  type: FilterType
): "append" | "set" {
  return configs.find((f) => f.type === type)?.multi ? "append" : "set";
}

/** Text + chevron inside a `DynamicDropdown` trigger. */
function DropdownTriggerLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <ChevronRight className="rotate-90" />
    </span>
  );
}

/** Spinner + label shown next to the active control while navigating. */
function FilterLoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <div className="animate-spin size-3 rounded-full border-2 border-gray-300 border-t-gray-600" />
      <span>Updating...</span>
    </div>
  );
}

/**
 * Determines if a report should show the timeframe picker.
 *
 * Some reports are "live" or "snapshot" views of current state and don't
 * benefit from timeframe filtering:
 * - Overdue Items: Shows currently overdue bookings (live state)
 * - Custody Snapshot: Shows current asset assignments (live state)
 * - Asset Inventory: Shows current inventory count (snapshot)
 * - Asset Distribution: Shows current distribution breakdown (snapshot)
 * - Idle Assets: Uses an idle threshold (days), not a timeframe range
 */
function showTimeframePicker(reportId: string): boolean {
  const liveOrSnapshotReports = [
    "overdue-items",
    "custody-snapshot",
    "asset-inventory",
    "distribution",
    "idle-assets",
  ];
  return !liveOrSnapshotReports.includes(reportId);
}

/**
 * Returns presets to exclude from the timeframe picker for a given report.
 *
 * Some reports don't benefit from very short timeframes (like "Today") because
 * their metrics only make sense over longer periods (e.g., booking duration
 * averages, monthly trends).
 */
function getExcludedPresets(reportId: string): TimeframePreset[] {
  switch (reportId) {
    // Top Booked Assets: Booking duration metrics need longer timeframes
    // "Today" would show incomplete/meaningless duration averages
    case "top-booked-assets":
    // Top Booked Kits: same rationale as Top Booked Assets
    // falls through
    case "top-booked-kits":
    // Monthly Booking Trends: By definition needs multi-month data
    // falls through
    case "monthly-booking-trends":
    // Asset Utilization: Utilization rates need sufficient time to be meaningful
    // falls through
    case "asset-utilization":
      return ["today"];
    default:
      return [];
  }
}
