import { useLoaderData } from "@remix-run/react";
import { AreaChart, Card, Title } from "@tremor/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsAreaChart() {
  const { assetsCreatedInEachMonth } = useLoaderData<typeof loader>();
  return (
    <>
      <Card className="mb-10">
        <Title>
          <div className="flex justify-between">
            <div>
              <span className="mb-2 block text-[14px] font-medium">
                Total inventory
              </span>
              <span className="block text-[30px] font-semibold text-gray-900">
                80 assets
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
          data={assetsCreatedInEachMonth}
          index="month"
          categories={["Assets Created"]}
          colors={["orange"]}
        />
      </Card>
    </>
  );
}
