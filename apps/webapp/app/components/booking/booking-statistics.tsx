import type { BookingStatus, Tag as PrismaTag, User } from "@prisma/client";
import type { BookingLifecycleProgress as BookingLifecycleProgressType } from "~/modules/booking/utils.server";
import { resolveUserDisplayName } from "~/utils/user";
import { BookingLifecycleProgress as BookingLifecycleProgressBar } from "./booking-lifecycle-progress";
import { CategoryBadge } from "../assets/category-badge";
import ItemsWithViewMore from "../list/items-with-view-more";
import { DateS } from "../shared/date";
import { InfoTooltip } from "../shared/info-tooltip";
import { Separator } from "../shared/separator";
import { Tag as TagBadge } from "../shared/tag";
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
  lifecycleProgress,
  autoArchivedAt,
  status,
}: {
  duration: string;
  totalAssets: number;
  kitsCount: number;
  assetsCount: number;
  totalValue: string;
  allCategories: { id: string; name: string; color: string }[];
  tags: Pick<PrismaTag, "id" | "name" | "color">[];
  creator: Pick<User, "id" | "firstName" | "lastName" | "profilePicture">;
  /**
   * Segmented checkout/check-in lifecycle progress. When present (and the
   * booking has any partial checkout/check-in activity), renders the
   * {@link BookingLifecycleProgressBar} segmented bar.
   */
  lifecycleProgress?: BookingLifecycleProgressType;
  autoArchivedAt?: Date | null;
  status: BookingStatus;
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

        {/* Check-out/check-in progress sits directly under Booking duration so
            the three composition counts (Assets / Kits / Total assets) stay
            grouped together below it. Conditionally rendered — only once the
            booking has partial checkout/check-in activity. */}
        {lifecycleProgress &&
          lifecycleProgress.totalUnits > 0 &&
          (lifecycleProgress.hasPartialCheckouts ||
            lifecycleProgress.hasPartialCheckins) && (
            <>
              <Separator />
              <BookingLifecycleProgressBar progress={lifecycleProgress} />
            </>
          )}
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
          <span className="text-sm text-gray-500">Tags</span>
          <div className="text-right">
            <ItemsWithViewMore
              items={tags}
              emptyMessage="No tags"
              renderItem={(tag) => (
                <TagBadge
                  key={tag.id}
                  color={tag.color ?? undefined}
                  withDot={false}
                >
                  {tag.name}
                </TagBadge>
              )}
            />
          </div>
        </div>
        <Separator />

        <div className="flex items-start justify-between">
          <span className="text-sm text-gray-500">Created by</span>

          <UserBadge
            name={resolveUserDisplayName(creator)}
            img={creator.profilePicture}
          />
        </div>

        {autoArchivedAt && status === "ARCHIVED" && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Automatically archived
              </span>
              <span className="text-right font-medium">
                <DateS date={autoArchivedAt} />
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
