import { useLoaderData } from "@remix-run/react";
import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";
import { Badge } from "../shared";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsByStatusChart() {
  const { assetsByStatus } = useLoaderData<typeof loader>();

  const { chartData, availableAssets, inCustodyAssets } = assetsByStatus;

  return (
    <div className="w-full border border-gray-200 ">
      <div className="flex items-center justify-between">
        <div className="flex-1 border-b p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
          Assets by status
        </div>
        <div className="border-b p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
          <InfoTooltip
            content={
              <>
                <h6>Assets by Status</h6>
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
            <ClientOnly fallback={<FallbackLoading className="h-80 w-80" />}>
              {() => (
                <DonutChart
                  className="mt-6 h-[240px] w-[240px] 2xl:h-[320px] 2xl:w-[320px]"
                  data={chartData}
                  category="assets"
                  index="status"
                  colors={["green", "blue"]}
                  showAnimation={true}
                  animationDuration={400}
                />
              )}
            </ClientOnly>

            <div className="min-w-[140px]">
              <ul className="flex flex-wrap items-center lg:block">
                <li>
                  <Badge color="#22c55e" noBg>
                    <span className="text-gray-600">
                      <strong className="text-gray-900">
                        {availableAssets}
                      </strong>{" "}
                      Available
                    </span>
                  </Badge>
                </li>
                <li>
                  <Badge color="#3b82f6" noBg>
                    <span className="text-gray-600">
                      <strong className="text-gray-900">
                        {inCustodyAssets}
                      </strong>{" "}
                      In Custody
                    </span>
                  </Badge>
                </li>
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
