import { useLoaderData } from "@remix-run/react";
import { Text, Flex, ProgressCircle } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { EmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";
import { InfoTooltip } from "../shared/info-tooltip";

export default function LocationRatioChart() {
  const { assets, totalAssets } = useLoaderData<typeof loader>();
  const assetsWithLocation = assets.filter((asset) => asset.locationId).length;

  return (
    <div className="w-full border border-color-200 ">
      <div className="flex items-center justify-between">
        <div className="flex-1 border-b p-4 text-left text-[14px] font-semibold  text-color-900 md:px-6">
          Location ratio
        </div>
        <div className="border-b p-4 text-right text-[14px] font-semibold  text-color-900 md:px-6">
          <InfoTooltip
            content={
              <>
                <h6>Location ratio</h6>
                <p>
                  This chart shows how much of your assets are in a defined
                  location
                </p>
              </>
            }
          />
        </div>
      </div>
      <div className="h-full p-8">
        {assetsWithLocation > 0 ? (
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
                    value={(assetsWithLocation / totalAssets) * 100}
                    size="xl"
                    color="orange"
                    className="relative"
                  >
                    <span className="block text-center text-xs font-medium text-color-600">
                      Location known <br />
                      <span className="block text-[14px] font-semibold leading-6 text-color-900">
                        {assetsWithLocation}/{totalAssets} assets
                      </span>
                    </span>
                  </ProgressCircle>
                )}
              </ClientOnly>

              <div>
                <Text className="mb-2 !text-[14px] font-medium text-color-600">
                  Location ratio
                </Text>
                <Text className="mb-3 !text-[30px] font-semibold text-color-900">
                  {`${((assetsWithLocation / totalAssets) * 100).toFixed(2)}%`}
                </Text>
              </div>
            </Flex>
          </div>
        ) : (
          <EmptyState text="No assets with values in database" />
        )}
      </div>
    </div>
  );
}
