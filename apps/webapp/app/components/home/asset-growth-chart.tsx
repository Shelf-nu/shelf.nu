import { AreaChart } from "@tremor/react";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/home";
import { DashboardEmptyState } from "../dashboard/empty-state";
import FallbackLoading from "../dashboard/fallback-loading";
import { Button } from "../shared/button";

export default function AssetGrowthChart() {
  const { assetGrowthData, totalAssets } = useLoaderData<typeof loader>();

  // Build short month labels: "Mar '25"
  const chartData = assetGrowthData.map(
    (d: { month: string; year: number; "Total assets": number }) => ({
      date: `${d.month.slice(0, 3)} '${String(d.year).slice(2)}`,
      "Total assets": d["Total assets"],
    })
  );

  return (
    <div className="flex h-full flex-col rounded border border-color-200 bg-surface">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-semibold text-color-900">
            Asset growth
          </span>
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-600">
            12 months
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            to="/assets"
            variant="block-link-gray"
            className="!mt-0 text-xs"
          >
            View all
          </Button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        {totalAssets > 0 ? (
          <ClientOnly
            fallback={<FallbackLoading className="h-[180px] w-full" />}
          >
            {() => (
              <AreaChart
                className="h-[180px] w-full"
                data={chartData}
                index="date"
                categories={["Total assets"]}
                colors={["orange"]}
                showAnimation={true}
                animationDuration={600}
                curveType="monotone"
                showLegend={false}
                showGridLines={false}
                yAxisWidth={40}
                autoMinValue={true}
              />
            )}
          </ClientOnly>
        ) : (
          <DashboardEmptyState
            text="No assets yet"
            subText="Create assets to see your growth trend here."
            ctaTo="/assets/new"
            ctaText="Create an asset"
          />
        )}
      </div>
    </div>
  );
}
