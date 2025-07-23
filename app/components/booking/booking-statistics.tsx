import type { Tag, User } from "@prisma/client";
import { CategoryBadge } from "../assets/category-badge";
import ItemsWithViewMore from "../list/items-with-view-more";
import { InfoTooltip } from "../shared/info-tooltip";
import { Separator } from "../shared/separator";
import { UserBadge } from "../shared/user-badge";

export function BookingStatistics({
  duration,
  totalAssets,
  kitsCount,
  assetsCount,
  totalValue,
  allCategories,
  tags,
  creator,
}: {
  duration: string;
  totalAssets: number;
  kitsCount: number;
  assetsCount: number;
  totalValue: string;
  allCategories: { id: string; name: string; color: string }[];
  tags: Pick<Tag, "id" | "name">[];
  creator: Pick<User, "id" | "firstName" | "lastName" | "profilePicture">;
}) {
  return (
    <div className="m-0">
      <h3>Booking statistics</h3>
      <div className="mt-4 flex flex-col gap-4">
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-color-500">Booking duration</span>
          <span className="text-right font-medium">{duration}</span>
        </div>

        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-color-500">Assets</span>
          <span className="text-right font-medium">{assetsCount}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="text-sm text-color-500">Kits</span>
          <span className="text-right font-medium">{kitsCount}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-sm text-color-500">
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
          <span className="text-sm text-color-500">Total value</span>
          <span className="text-right font-medium">{totalValue}</span>
        </div>
        <Separator />
        <div className="flex items-start justify-between">
          <span className="text-sm text-color-500">Categories</span>
          <div className="text-right">
            <ItemsWithViewMore
              items={allCategories}
              emptyMessage="No categories"
              renderItem={(category) => (
                <CategoryBadge category={category} key={category.id} />
              )}
            />
          </div>
        </div>
        <Separator />
        <div className="flex items-start justify-between">
          <span className="text-sm text-color-500">Tags</span>
          <div className="text-right">
            <ItemsWithViewMore
              items={tags}
              labelKey="name"
              idKey="id"
              emptyMessage="No tags"
            />
          </div>
        </div>
        <Separator />

        <div className="flex items-start justify-between">
          <span className="text-sm text-color-500">Created by</span>

          <UserBadge
            name={`${creator.firstName} ${creator.lastName}`}
            img={creator.profilePicture}
          />
        </div>
      </div>
    </div>
  );
}
