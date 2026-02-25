import { DonutChart } from "@tremor/react";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/home";
import { DashboardEmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";

import { Badge } from "../shared/badge";
import { Button } from "../shared/button";

export default function AssetsByStatusChart() {
  const { assetsByStatus } = useLoaderData<typeof loader>();

  const { chartData } = assetsByStatus;

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Assets by status
        </span>
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
      <div className="flex flex-1 items-center justify-center p-6">
        {chartData?.length > 0 ? (
          <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-between">
            <ClientOnly fallback={<FallbackLoading className="size-40" />}>
              {() => (
                <DonutChart
                  className="size-[160px]"
                  data={chartData}
                  category="assets"
                  index="status"
                  colors={["green", "blue", "purple"]}
                  showAnimation={true}
                  animationDuration={400}
                />
              )}
            </ClientOnly>

            <div className="min-w-[140px]">
              <ul className="flex flex-wrap items-center lg:block">
                {chartData
                  .sort((a, b) => b.assets - a.assets)
                  .map((data) => {
                    const { status, assets, color } = data;
                    return (
                      <li key={status}>
                        <Badge color={color} noBg>
                          <span className="text-gray-600">
                            <strong className="text-gray-900">{assets}</strong>{" "}
                            {status}
                          </span>
                        </Badge>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>
        ) : (
          <DashboardEmptyState
            text="No assets yet"
            subText="Add assets to see their status distribution here."
            ctaTo="/assets/new"
            ctaText="Create an asset"
          />
        )}
      </div>
    </div>
  );
}
