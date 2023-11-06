import { useLoaderData } from "@remix-run/react";
import { AreaChart, Card, Title } from "@tremor/react";
import type { loader } from "~/routes/_layout+/dashboard";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsAreaChart() {
  const chartDataStatic = [
    { month: "January", "Assets Created": 23 },
    { month: "February", "Assets Created": 27 },
    { month: "March", "Assets Created": 17 },
    { month: "April", "Assets Created": 30 },
    { month: "May", "Assets Created": 36 },
    { month: "June", "Assets Created": 22 },
    { month: "July", "Assets Created": 29 },
    { month: "August", "Assets Created": 33 },
    { month: "September", "Assets Created": 49 },
    { month: "October", "Assets Created": 31 },
    { month: "November", "Assets Created": 43 },
    { month: "December", "Assets Created": 38 },
  ];
  const { chartData } = useLoaderData<typeof loader>;
  console.log(chartData);
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
          data={chartDataStatic}
          index="month"
          categories={["Assets Created"]}
          colors={["orange"]}
        />
      </Card>
    </>
  );
}
