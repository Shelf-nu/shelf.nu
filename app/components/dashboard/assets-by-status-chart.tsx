import { Card, DonutChart } from "@tremor/react";

const data = [
  {
    status: "Available",
    assets: 45,
  },
  {
    status: "In Custody",
    assets: 69,
  },
];

export default function AssetsByStatusChart() {
  <Card className="max-w-lg">
    <DonutChart
      className="mt-6"
      data={data}
      category="assets"
      index="status"
      colors={["green", "blue"]}
    />
  </Card>;
}
