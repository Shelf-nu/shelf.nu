import { useLoaderData } from "@remix-run/react";
import { Text, Flex, ProgressCircle } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";
import { InfoTooltip } from "../shared/info-tooltip";

export default function InventoryValueChart() {
  const { assets, currency, totalAssets, totalValuation, locale } =
    useLoaderData<typeof loader>();
  const valueKnownAssets = assets.filter(
    (asset) => asset.valuation !== null
  ).length;

  return (
    <div className="w-full border border-gray-200 ">
      <div className="flex items-center justify-between">
        <div className="flex-1 border-b p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
          Inventory value
        </div>
        <div className="border-b p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
          <InfoTooltip
            content={
              <>
                <h6>Inventory value</h6>
                <p>This chart shows how much value your assets hold</p>
              </>
            }
          />
        </div>
      </div>
      <div className="h-full p-8">
        {valueKnownAssets > 0 ? (
          <div className="space-y-3">
            <Flex
              className="space-x-5"
              justifyContent="evenly"
              alignItems="end"
            >
              <ClientOnly
                fallback={<FallbackLoading className="size-[150px]" />}
              >
                {() => (
                  <ProgressCircle
                    value={(valueKnownAssets / totalAssets) * 100}
                    size="xl"
                    color="orange"
                    className="relative"
                  >
                    <span className="block text-center text-xs font-medium text-gray-600">
                      Value Known <br />
                      <span className="block text-[14px] font-semibold leading-6 text-gray-900">
                        {valueKnownAssets}/{totalAssets} assets
                      </span>
                      {`(${((valueKnownAssets / totalAssets) * 100).toFixed(
                        2
                      )}%)`}
                    </span>
                  </ProgressCircle>
                )}
              </ClientOnly>
              <div>
                <Text className="mb-2 !text-[14px] font-medium text-gray-600">
                  Inventory value
                </Text>
                <Text className="mb-3 !text-[30px] font-semibold text-gray-900">
                  {(totalValuation || 0).toLocaleString(locale, {
                    style: "currency",
                    currency: currency,
                  })}
                </Text>
              </div>
            </Flex>
          </div>
        ) : (
          <EmptyState text="No assets with values exists in database" />
        )}
      </div>
    </div>
  );
}
