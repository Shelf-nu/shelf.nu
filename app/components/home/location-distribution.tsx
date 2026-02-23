import { useLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/home";
import { ClickableTr } from "../dashboard/clickable-tr";
import { DashboardEmptyState } from "../dashboard/empty-state";
import { Button } from "../shared/button";

import { Table, Td } from "../table";

export default function LocationDistribution() {
  const { locationDistribution } = useLoaderData<typeof loader>();

  const maxCount =
    locationDistribution.length > 0
      ? Math.max(...locationDistribution.map((l: any) => l.assetCount))
      : 0;

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Top locations
        </span>
        <div className="flex items-center gap-2">
          <Button
            to="/locations"
            variant="block-link-gray"
            className="!mt-0 text-xs"
          >
            View all
          </Button>
        </div>
      </div>
      {locationDistribution.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {locationDistribution.map((loc: any) => (
              <ClickableTr
                key={loc.locationId}
                to={`/locations/${loc.locationId}`}
              >
                <Td className="w-full">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {loc.locationName}
                      </span>
                      <span className="text-xs text-gray-500">
                        {loc.assetCount} asset
                        {loc.assetCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-primary-500"
                        style={{
                          width: `${
                            maxCount > 0 ? (loc.assetCount / maxCount) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </Td>
              </ClickableTr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <DashboardEmptyState
            text="No locations assigned"
            subText="Assign locations to assets to see distribution here."
            ctaTo="/locations"
            ctaText="Manage locations"
          />
        </div>
      )}
    </div>
  );
}
