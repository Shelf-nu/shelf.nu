import { useLoaderData } from "@remix-run/react";
import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { Badge } from "../shared";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsByStatusChart() {
  const { assetsByStatus } = useLoaderData<typeof loader>();

  const { chartData, availableAssets, inCustodyAssets } = assetsByStatus;

  return (
    <ClientOnly fallback={null}>
      {() => (
        <div className="mb-4 w-full rounded border border-gray-200 lg:w-1/2">
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
          <div className="p-8">
            <div className="flex gap-4">
              <DonutChart
                className="mt-6"
                data={chartData}
                category="assets"
                index="status"
                colors={["green", "blue"]}
                showAnimation={true}
                animationDuration={400}
              />
              <div className="min-w-[120px]">
                <ul className="chart-items">
                  <li>
                    <Badge color="#22c55e" noBg>
                      <strong>{availableAssets}</strong> Available
                    </Badge>
                  </li>
                  <li>
                    <Badge color="#3b82f6" noBg>
                      <strong>{inCustodyAssets}</strong> In custody
                    </Badge>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </ClientOnly>
  );
}
