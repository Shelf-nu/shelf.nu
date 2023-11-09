import { useLoaderData } from "@remix-run/react";
import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { Button } from "../shared";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsByCategoryChart() {
  const { assetsByCategory } = useLoaderData<typeof loader>();

  return (
    <ClientOnly fallback={null}>
      {() => (
        <div className="mb-4 w-full rounded border border-gray-200 lg:w-1/2">
          <div className="flex items-center justify-between">
            <div className="flex-1 border-b p-4 text-left text-[14px] font-semibold  text-gray-900 md:px-6">
              Assets by category (top 6)
            </div>
            <div className="border-b p-4 text-right text-[14px] font-semibold  text-gray-900 md:px-6">
              <InfoTooltip
                content={
                  <>
                    <h6>Assets by Category</h6>
                    <p>
                      Below graph shows how many percent of assets are in which
                      category{" "}
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
                data={assetsByCategory}
                category="assets"
                index="category"
                showAnimation={true}
                animationDuration={400}
              />
              <div className="min-w-[120px]">
                <ul className="chart-items">
                  {assetsByCategory.map((cd) => (
                    <li className="my-1" key={cd.category}>
                      <Button
                        to={`/assets?category=${cd.id}`}
                        variant="link"
                        className="border text-gray-700 hover:text-gray-500"
                      >
                        <strong>{cd.assets}</strong> {cd.category}
                      </Button>
                    </li>
                  ))}
                  <li>
                    <Button to="/categories" variant="link">
                      See all
                    </Button>
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
