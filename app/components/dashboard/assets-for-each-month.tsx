import { useLoaderData } from "@remix-run/react";
import { AreaChart, Card, Title } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsForEachMonth() {
  const { totalAssetsAtEndOfEachMonth, totalAssets } =
    useLoaderData<typeof loader>();
  return (
    <ClientOnly fallback={null}>
      {() => (
        <Card className="mb-10 py-4 lg:p-6">
          <Title>
            <div className="flex justify-between">
              <div>
                <span className="mb-2 block text-[14px] font-medium">
                  Total inventory
                </span>
                <span className="block text-[30px] font-semibold text-gray-900">
                  {totalAssets} assets
                </span>
              </div>
              <InfoTooltip
                content={
                  <>
                    <h6>Total inventory</h6>
                    <p>
                      Below graph shows the total assets you have created in the
                      last year
                    </p>
                  </>
                }
              />
            </div>
          </Title>
          <AreaChart
            className="mt-4 h-72"
            data={totalAssetsAtEndOfEachMonth}
            index="month"
            categories={["Total assets"]}
            colors={["orange"]}
            showAnimation={true}
            animationDuration={400}
            curveType="monotone"
          />
        </Card>
      )}
    </ClientOnly>
  );
}
