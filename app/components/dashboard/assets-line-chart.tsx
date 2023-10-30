import { Card, LineChart, Title } from "@tremor/react";

export default function AssetsLineChart() {
  const chartData = [
    { month: "January", "Assets Created": 23 },
    { month: "February", "Assets Created": 45 },
    { month: "March", "Assets Created": 67 },
    { month: "April", "Assets Created": 12 },
    { month: "May", "Assets Created": 89 },
    { month: "June", "Assets Created": 34 },
    { month: "July", "Assets Created": 56 },
    { month: "August", "Assets Created": 78 },
    { month: "September", "Assets Created": 90 },
    { month: "October", "Assets Created": 21 },
    { month: "November", "Assets Created": 43 },
    { month: "December", "Assets Created": 65 },
  ];
  return (
    <>
      <Card>
        <Title>Total inventory</Title>
        <LineChart
          className="mt-4 h-72"
          data={chartData}
          index="date"
          categories={["running"]}
          colors={["orange"]}
          yAxisWidth={30}
        />
      </Card>
    </>
  );
}
