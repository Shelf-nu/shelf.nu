import { useLoaderData } from "@remix-run/react";
import type { Color } from "@tremor/react";
import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/dashboard";
import { Badge, Button } from "../shared";
import { InfoTooltip } from "../shared/info-tooltip";

export default function AssetsByCategoryChart() {
  const { assetsByCategory } = useLoaderData<typeof loader>();
  const chartColors: Color[] = [
    "slate",
    "sky",
    "rose",
    "orange",
    "red",
    "purple",
  ];

  const correspondingChartColorsHex: string[] = [
    "#64748b",
    "#0ea5e9",
    "#f43f5e",
    "#f97316",
    "#ef4444",
    "#a855f7",
  ];

  return (
    <ClientOnly fallback={null}>
      {() => (
        <div className="mb-4 w-full rounded border border-gray-200">
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
            <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-between">
              <DonutChart
                className="mt-6 h-[240px] w-[240px]  2xl:h-[320px] 2xl:w-[320px]"
                data={assetsByCategory}
                category="assets"
                index="category"
                showAnimation={true}
                animationDuration={400}
                colors={chartColors}
              />
              <div className="min-w-[140px]">
                <ul className="flex flex-wrap items-center lg:block">
                  {assetsByCategory.map((cd, i) => (
                    <li className="my-1" key={cd.category}>
                      <Button
                        to={`/assets?category=${cd.id}`}
                        variant="link"
                        className="border text-gray-700 hover:text-gray-500"
                      >
                        <Badge color={correspondingChartColorsHex[i]} noBg>
                          <span className="text-gray-600">
                            <strong className="text-gray-900">
                              {cd.assets}
                            </strong>{" "}
                            {cd.category}
                          </span>
                        </Badge>
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
