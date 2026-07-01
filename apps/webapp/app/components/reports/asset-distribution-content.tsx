/**
 * @file Asset Distribution Report Content
 *
 * Renders the body of the "Asset Distribution" report: a hero section with
 * total-asset KPIs followed by three clickable donut charts (by category, by
 * location, by status). Clicking a donut legend item navigates to the assets
 * index pre-filtered by that dimension.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 */

import { useNavigate } from "react-router";

import { DistributionDonut } from "~/components/reports/distribution-donut";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { DistributionBreakdown, ReportKpi } from "~/modules/reports/types";
import { useHints } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";

/** Props for {@link AssetDistributionContent}. */
type Props = {
  /** KPI tiles for the report (total assets, total value, totals of categories/locations). */
  kpis: ReportKpi[];
  /** Breakdown buckets used to render the three donut charts. Optional because
   *  the loader may omit it on error / empty states. */
  distributionBreakdown?: DistributionBreakdown;
};

/**
 * Renders the Asset Distribution report content (hero KPIs + 3 donut charts).
 *
 * Each donut's legend item is clickable; clicking navigates to `/assets` with
 * the appropriate filter query string so the user can drill into the slice.
 *
 * @param props - See {@link Props}.
 */
export function AssetDistributionContent({
  kpis,
  distributionBreakdown,
}: Props) {
  const navigate = useNavigate();
  const currentOrganization = useCurrentOrganization();
  const { locale } = useHints();

  // Navigate to assets filtered by the clicked item
  // IDs match the special filter values: "uncategorized", "without-location", or actual IDs
  const handleCategoryClick = (item: { id: string }) => {
    void navigate(`/assets?category=${encodeURIComponent(item.id)}`);
  };

  const handleLocationClick = (item: { id: string }) => {
    void navigate(`/assets?location=${encodeURIComponent(item.id)}`);
  };

  const handleStatusClick = (item: { id: string }) => {
    void navigate(`/assets?status=${encodeURIComponent(item.id)}`);
  };

  // Extract KPI values
  const totalAssets =
    (kpis.find((k) => k.id === "total_assets")?.rawValue as number) || 0;
  const totalValue =
    (kpis.find((k) => k.id === "total_value")?.rawValue as number) || 0;
  const totalCategories =
    (kpis.find((k) => k.id === "total_categories")?.rawValue as number) || 0;
  const totalLocations =
    (kpis.find((k) => k.id === "total_locations")?.rawValue as number) || 0;

  return (
    <div className="space-y-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalAssets}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Assets
              </span>
              <span className="text-xs text-gray-500">
                Across {totalCategories} categories, {totalLocations} locations
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalValue > 0
                  ? formatCurrency({
                      value: totalValue,
                      currency: currentOrganization?.currency ?? "USD",
                      locale,
                    })
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution donut charts - clickable to filter assets */}
      {distributionBreakdown && (
        <div className="grid gap-6 lg:grid-cols-3">
          <DistributionDonut
            title="By Category"
            data={distributionBreakdown.byCategory}
            emptyMessage="No categories defined"
            maxLegendItems={5}
            onItemClick={handleCategoryClick}
          />
          <DistributionDonut
            title="By Location"
            data={distributionBreakdown.byLocation}
            emptyMessage="No locations defined"
            maxLegendItems={5}
            onItemClick={handleLocationClick}
          />
          <DistributionDonut
            title="By Status"
            data={distributionBreakdown.byStatus}
            emptyMessage="No status data"
            maxLegendItems={5}
            onItemClick={handleStatusClick}
          />
        </div>
      )}
    </div>
  );
}
