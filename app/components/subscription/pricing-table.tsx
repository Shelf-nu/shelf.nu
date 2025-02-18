import type { PriceWithProduct } from "./prices";
import { Prices } from "./prices";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/tabs";

export function PricingTable({
  prices,
}: {
  prices: {
    [key: string]: PriceWithProduct[];
  };
}) {
  return (
    <Tabs defaultValue={"year"} className="flex w-full flex-col">
      <TabsList className="center mx-auto mb-8">
        <TabsTrigger value="year">
          Yearly{" "}
          <span className="ml-2 rounded-[16px] bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700">
            Save 54%
          </span>
        </TabsTrigger>
        <TabsTrigger value="month">Monthly</TabsTrigger>
      </TabsList>
      <TabsContent value="year">
        <Prices prices={prices["year"]} />
      </TabsContent>
      <TabsContent value="month">
        <Prices prices={prices["month"]} />
      </TabsContent>
    </Tabs>
  );
}
