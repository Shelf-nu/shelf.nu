import type { BookingStatus, Tag as PrismaTag, User } from "@prisma/client";
import type { BookingLifecycleProgress as BookingLifecycleProgressType } from "~/modules/booking/utils.server";
import { BADGE_COLORS } from "~/utils/badge-colors";
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
  unassignedModelUnits,
  canAssignModelUnits: canAssign,
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
  /**
   * Reserved model units still awaiting a physical asset. Counted in UNITS,
   * not request rows, via `countUnassignedModelUnits`. `0` hides the row.
   */
  unassignedModelUnits: number;
  /**
   * Whether those units can still be assigned. On a finished, cancelled or
   * archived booking they are history, so the amber "needs attention" emphasis
   * is dropped and the label reads in the past tense.
   */
  canAssignModelUnits: boolean;
  totalValue: string;
  allCategories: { id: string; name: string; color: string }[];
  tags: Pick<PrismaTag, "id" | "name" | "color">[];
  creator: Pick<
    User,
    "id" | "firstName" | "lastName" | "displayName" | "profilePicture"
  >;
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

        {/* Reserved model units that have no physical asset behind them yet.
            Shown ONLY when there are some, and in the same amber the
            reservations section and the bookings-index pill use.

            Every count above this row is concrete assets, which is correct and
            was also completely silent about a booking still owing units. A
            summary that omits the outstanding work reads as "this booking is
            complete" — the exact impression that produced the original report.
            @see {@link file://./booking-model-reservations-section.tsx} */}
        {unassignedModelUnits > 0 && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-sm text-gray-500">
                {canAssign
                  ? "Unassigned model units"
                  : "Model units never assigned"}{" "}
                <InfoTooltip
                  iconClassName="size-4"
                  content={
                    <p>
                      Units reserved against an asset model
                      {canAssign
                        ? " that have not been matched to a physical asset yet."
                        : " that were never matched to a physical asset."}{" "}
                      They are not counted in the asset totals above, and they
                      are not included in total value because no specific asset
                      was ever chosen.
                    </p>
                  }
                />
              </span>
              <span
                className="rounded-2xl px-2 py-[2px] text-right text-xs font-medium"
                style={{
                  backgroundColor: canAssign
                    ? BADGE_COLORS.amber.bg
                    : BADGE_COLORS.gray.bg,
                  color: canAssign
                    ? BADGE_COLORS.amber.text
                    : BADGE_COLORS.gray.text,
                }}
              >
                {unassignedModelUnits}
              </span>
            </div>
          </>
        )}
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

          <UserBadge user={creator} />
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
