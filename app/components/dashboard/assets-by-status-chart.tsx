import { useLoaderData } from "@remix-run/react";
import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";

import { Badge } from "../shared/badge";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsByStatusChart() {
  const { assetsByStatus } = useLoaderData<typeof loader>();

  const { chartData } = assetsByStatus;

  return (
    <div className="w-full border border-color-200 ">
      <div className="flex items-center justify-between">
        <div className="flex-1 border-b p-4 text-left text-[14px] font-semibold  text-color-900 md:px-6">
          Assets by status
        </div>
        <div className="border-b p-4 text-right text-[14px] font-semibold  text-color-900 md:px-6">
          <InfoTooltip
            content={
              <>
                <h6>Assets by status</h6>
                <p>
                  Below graph shows how many percent of assets are in which
                  status{" "}
                </p>
              </>
            }
          />
        </div>
      </div>
      <div className="h-full p-8">
        {chartData?.length > 0 ? (
          <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-between">
            <ClientOnly fallback={<FallbackLoading className="size-80" />}>
              {() => (
                <DonutChart
                  className="mt-6 size-[240px] 2xl:size-[320px]"
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
                          <span className="text-color-600">
                            <strong className="text-color-900">{assets}</strong>{" "}
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
          <EmptyState text="No assets in database" />
        )}
      </div>
    </div>
  );
}
