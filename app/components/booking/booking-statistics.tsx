import type { Category } from "@prisma/client";
import { Badge } from "../shared/badge";
import { GrayBadge } from "../shared/gray-badge";
import { InfoTooltip } from "../shared/info-tooltip";
import { Separator } from "../shared/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export function BookingStatistics({
  duration,
  totalAssets,
  kitsCount,
  assetsCount,
  totalValue,
  allCategories,
}: {
  duration: string;
  totalAssets: number;
  kitsCount: number;
  assetsCount: number;
  totalValue: string;
  allCategories: { id: string; name: string; color: string }[];
}) {
  return (
    <div className="m-0">
      <h3>Booking statistics</h3>
      <div className="mt-4 flex flex-col gap-4">
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Booking duration</span>
          <span className="text-right font-medium">{duration}</span>
        </div>

        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Assets</span>
          <span className="text-right font-medium">{assetsCount}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Kits</span>
          <span className="text-right font-medium">{kitsCount}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-sm text-gray-500">
            Total assets{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <p>
                  The total number of assets in this booking including assets
                  inside kits.
                </p>
              }
            />
          </span>
          <span className="text-right font-medium">{totalAssets}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total value</span>
          <span className="text-right font-medium">{totalValue}</span>
        </div>
        <Separator />
        <div className="flex items-start justify-between">
          <span className="text-sm text-gray-500">Categories</span>
          <div className="text-right">
            {allCategories.length === 0 ? (
              "No categories"
            ) : (
              <ListItemCategoriesColumn categories={allCategories} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ListItemCategoriesColumn = ({
  categories,
}: {
  categories: Pick<Category, "id" | "name" | "color">[] | undefined;
}) => {
  // Filter out any null/undefined categories first
  const filteredCategories = categories?.filter(Boolean) || [];

  // Show only the first 3 categories
  const visibleCategories = filteredCategories.slice(0, 2);
  const remainingCategories = filteredCategories.slice(2);

  return filteredCategories.length > 0 ? (
    <div className="text-right">
      {visibleCategories.map((category) => (
        <Badge
          key={category.id}
          color={category.color}
          withDot={false}
          className="mb-2 ml-2"
        >
          {category.name}
        </Badge>
      ))}
      {remainingCategories.length > 0 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <GrayBadge className="ml-2">{`+${
                filteredCategories.length - 3
              }`}</GrayBadge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72">
              {remainingCategories.map((category) => (
                <Badge
                  key={category.id}
                  color={category.color}
                  withDot={false}
                  className="mb-2 mr-2"
                >
                  {category.name}
                </Badge>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  ) : null;
};
