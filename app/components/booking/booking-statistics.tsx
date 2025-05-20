import { Card } from "../shared/card";
import { InfoTooltip } from "../shared/info-tooltip";
import { Separator } from "../shared/separator";

export function BookingStatistics({
  duration,
  totalAssets,
  totalKits,
  totalValue,
}: {
  duration: string;
  totalAssets: number;
  totalKits: number;
  totalValue: string;
}) {
  return (
    <Card className="mt-0 w-1/3">
      <h3>Booking statistics</h3>
      <div className="mt-4 flex flex-col gap-4">
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Booking duration</span>
          <span className="font-medium">{duration}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-gray-500">
            Total assets{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <>
                  <p>
                    The total number of assets in this booking including assets
                    inside kits.
                  </p>
                </>
              }
            />
          </span>
          <span className="font-medium">{totalAssets}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total kits</span>
          <span className="font-medium">{totalKits}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total value</span>
          <span className="font-medium">{totalValue}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Categories</span>
          <div className="flex space-x-1"></div>
        </div>
      </div>
    </Card>
  );
}
