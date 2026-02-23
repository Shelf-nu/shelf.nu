import { Text, ProgressCircle } from "@tremor/react";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/home";
import { formatCurrency } from "~/utils/currency";
import { DashboardEmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";

export default function InventoryValueChart() {
  const { currency, totalAssets, totalValuation, valueKnownAssets, locale } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Inventory value
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        {valueKnownAssets > 0 ? (
          <div className="space-y-3">
            <div
              data-testid="inventory-value-layout"
              className="flex flex-col items-center gap-6 md:flex-row md:items-end md:justify-evenly"
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
              <div className="min-w-0 text-center md:text-right">
                <Text className="mb-2 !text-[14px] font-medium text-gray-600">
                  Inventory value
                </Text>
                <Text className="mb-3 break-all !text-[22px] font-semibold text-gray-900 md:!text-[30px]">
                  {formatCurrency({
                    value: totalValuation || 0,
                    locale,
                    currency,
                  })}
                </Text>
              </div>
            </div>
          </div>
        ) : (
          <DashboardEmptyState
            text="No asset values yet"
            subText="Add valuations to your assets to see your total inventory value here."
            ctaTo="/assets"
            ctaText="Go to assets"
          />
        )}
      </div>
    </div>
  );
}
