import { useMemo } from "react";
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { BookingWithCustodians } from "~/modules/booking/types";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import {
  getBookingContextAssetStatus,
  isAssetPartiallyCheckedIn,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import { AvailabilityLabel } from "./availability-label";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { ListItemTagsColumn } from "../assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "../assets/category-badge";
import { ConsumptionTypeBadge } from "../assets/consumption-type-badge";
import BulkListItemCheckbox from "../list/bulk-actions/bulk-list-item-checkbox";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import { EmptyTableValue } from "../shared/empty-table-value";
import { ReturnedBadge } from "../shared/returned-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { UserBadge } from "../shared/user-badge";
import { Td } from "../table";
import When from "../when/when";

type ListAssetContentProps = {
  item: AssetWithBooking;
  isKitAsset?: boolean;
  partialCheckinDetails: PartialCheckinDetailsType;
  shouldShowCheckinColumns: boolean;
};

export default function ListAssetContent({
  item,
  isKitAsset,
  partialCheckinDetails,
  shouldShowCheckinColumns,
}: ListAssetContentProps) {
  const { category, tags } = item;
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isBase, isSelfService, isBaseOrSelfService } = useUserRoleHelper();
  const { isReserved, isDraft, isFinished } = useBookingStatusHelpers(
    booking.status
  );
  const user = useUserData();

  /** Weather the asset is checked out in a booking different than the current one */
  const isCheckedOut = useMemo(
    () =>
      (item.status === AssetStatus.CHECKED_OUT &&
        !item.bookingAssets.some((ba) => ba.booking.id === booking.id) &&
        // Only exclude assets from current booking if current booking is ONGOING/OVERDUE
        !(
          booking.bookingAssets.some(
            (ba: { assetId: string }) => ba.assetId === item.id
          ) &&
          (booking.status === "ONGOING" || booking.status === "OVERDUE")
        )) ??
      false,
    [
      item.status,
      item.bookingAssets,
      booking.id,
      booking.bookingAssets,
      item.id,
      booking.status,
    ]
  );

  const isPartOfKit = (item.assetKits ?? []).length > 0;

  // New logic for determining if actions dropdown should be shown
  const canSeeActions = useMemo(() => {
    // Never show actions if asset is part of a kit
    if (isPartOfKit) return false;

    // Admins and owners can always see actions
    if (!isBaseOrSelfService) return true;

    // Check if user is the custodian of the item
    const isUserCustodian = booking?.custodianUser?.id === user?.id;

    // Base role: can see actions if booking is Draft AND user is custodian
    if (isBase && isDraft && isUserCustodian) return true;

    // SelfService role: can see actions if (Draft OR Reserved) AND user is custodian
    if (isSelfService && (isDraft || isReserved) && isUserCustodian)
      return true;

    return false;
  }, [
    isPartOfKit,
    booking?.custodianUser?.id,
    user?.id,
    isBase,
    isDraft,
    isSelfService,
    isReserved,
    isBaseOrSelfService,
  ]);

  // Use centralized status resolver for consistency
  const baseContextStatus = getBookingContextAssetStatus(
    item,
    partialCheckinDetails,
    booking.status
  );

  /**
   * Phase 3c: qty-tracked partial dispositioning.
   *
   * A qty-tracked asset doesn't get added to `PartialBookingCheckin.assetIds`
   * until its `remaining` hits zero, so `partialCheckinDetails` is blind to
   * "some units checked in, others outstanding". We detect that here from
   * the `dispositionedQuantity` attached by the overview loader, and
   * upgrade the row's visible status to `PARTIALLY_CHECKED_IN` so the
   * badge and any consumers of this status reflect reality.
   *
   * Guarded on `ONGOING`/`OVERDUE` because a COMPLETE/ARCHIVED booking
   * should show the original status (consistent with the existing
   * individual-asset behavior).
   */
  const qtyBooked = item.bookedQuantity ?? 0;
  const qtyDispositioned = item.dispositionedQuantity ?? 0;
  const qtyRemaining = Math.max(0, qtyBooked - qtyDispositioned);
  /**
   * Per-category disposition sums shipped by the overview loader so the
   * tooltip can distinguish Returned (back to pool) from Lost / Damaged
   * (deducted from pool) and Consumed (ONE_WAY). Missing shape falls
   * back to all-zero — older routes that haven't adopted the breakdown
   * still render (degrades to the previous "Checked in: N" display).
   */
  const qtyBreakdown = item.dispositionBreakdown ?? {
    returned: 0,
    consumed: 0,
    lost: 0,
    damaged: 0,
  };
  const isQtyPartiallyCheckedIn =
    isQuantityTracked(item) &&
    qtyBooked > 0 &&
    qtyDispositioned > 0 &&
    qtyRemaining > 0 &&
    (booking.status === "ONGOING" || booking.status === "OVERDUE");

  const contextStatus = isQtyPartiallyCheckedIn
    ? "PARTIALLY_CHECKED_IN_QTY"
    : baseContextStatus;

  const isPartiallyCheckedIn =
    isQtyPartiallyCheckedIn ||
    isAssetPartiallyCheckedIn(item, partialCheckinDetails, booking.status);

  return (
    <>
      <When truthy={!isKitAsset} fallback={<Td> </Td>}>
        <BulkListItemCheckbox item={item} />
      </When>

      <Td className={tw("w-full whitespace-normal p-0 md:p-0")}>
        {isKitAsset && (
          <div className="absolute inset-y-0 left-0 h-full w-2 bg-gray-100" />
        )}
        <div
          className={tw(
            "flex justify-between gap-3 py-4 md:justify-normal md:pr-6",
            isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className={tw(
                  "size-full rounded-[4px] border object-cover",
                  isKitAsset ? "border-gray-300" : ""
                )}
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover={true}
                >
                  {item.title}
                </Button>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {isFinished ? (
                  <ReturnedBadge />
                ) : (
                  <AssetStatusBadge
                    id={item.id}
                    status={contextStatus}
                    availableToBook={item.availableToBook}
                    asset={item}
                  />
                )}
                {/* Minimal qty-tracked hint — renders nothing for
                    INDIVIDUAL assets. */}
                <ConsumptionTypeBadge
                  consumptionType={item.consumptionType ?? null}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/* Qty column — Empty for INDIVIDUAL assets. For qty-tracked:
          shows just the booked total until there's check-in activity.
          Once units have been dispositioned we show progress as
          `checked-in / booked` (counts UP, like a progress indicator),
          with an explanatory tooltip and a success check when full. */}
      <Td className={tw("text-center", isKitAsset ? "bg-gray-50/50" : "")}>
        {isQuantityTracked(item) && qtyBooked > 0 ? (
          qtyDispositioned > 0 ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={tw(
                      "inline-flex cursor-help items-center gap-1 tabular-nums",
                      qtyRemaining === 0 ? "text-emerald-700" : "text-gray-900"
                    )}
                  >
                    <span className="font-medium">{qtyDispositioned}</span>
                    <span className="text-gray-400">/ {qtyBooked}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="max-w-xs">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="font-semibold text-gray-900">
                      {qtyRemaining === 0
                        ? "All units checked in"
                        : "Partially checked in"}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-600">Booked</span>
                      <span className="tabular-nums text-gray-900">
                        {qtyBooked}
                      </span>
                    </div>
                    {/* Per-category disposition breakdown. Only render
                        the rows with non-zero counts so a ONE_WAY
                        asset doesn't show a Returned=0 line, and
                        vice versa. */}
                    {qtyBreakdown.returned > 0 ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">Returned</span>
                        <span className="tabular-nums text-emerald-700">
                          {qtyBreakdown.returned}
                        </span>
                      </div>
                    ) : null}
                    {qtyBreakdown.consumed > 0 ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">Consumed</span>
                        <span className="tabular-nums text-gray-900">
                          {qtyBreakdown.consumed}
                        </span>
                      </div>
                    ) : null}
                    {qtyBreakdown.lost > 0 ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">Lost</span>
                        <span className="tabular-nums text-rose-700">
                          {qtyBreakdown.lost}
                        </span>
                      </div>
                    ) : null}
                    {qtyBreakdown.damaged > 0 ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600">Damaged</span>
                        <span className="tabular-nums text-amber-700">
                          {qtyBreakdown.damaged}
                        </span>
                      </div>
                    ) : null}
                    {/* Summary row kept at the bottom as a total so
                        operators can sanity-check the split adds up. */}
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-gray-100 pt-1">
                      <span className="text-gray-600">Remaining</span>
                      <span
                        className={tw(
                          "tabular-nums",
                          qtyRemaining === 0
                            ? "text-gray-400"
                            : "font-medium text-amber-700"
                        )}
                      >
                        {qtyRemaining}
                      </span>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="tabular-nums">{qtyBooked}</span>
          )
        ) : null}
      </Td>

      {/* If asset status is different than available, we need to show a label */}
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {!isFinished ? (
          <AvailabilityLabel asset={item} isCheckedOut={isCheckedOut} />
        ) : null}
      </Td>
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        <CategoryBadge category={category} />
      </Td>
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        <ListItemTagsColumn tags={tags} />
      </Td>

      {shouldShowCheckinColumns && (
        <>
          {/* Checked in on */}
          <Td
            className={tw(
              isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
            )}
          >
            {/* Only INDIVIDUAL partials populate `partialCheckinDetails`
                (qty-tracked partials live in ConsumptionLog across
                multiple sessions and don't have a single "checked in
                at" timestamp to show). Guard on the lookup rather than
                `isPartiallyCheckedIn` alone — the latter is also true
                for qty-tracked partials, where the lookup is
                undefined. */}
            {isPartiallyCheckedIn && partialCheckinDetails[item.id] ? (
              <span className="text-sm text-gray-600">
                <DateS
                  date={partialCheckinDetails[item.id].checkinDate}
                  includeTime
                />
              </span>
            ) : (
              <EmptyTableValue />
            )}
          </Td>

          {/* Checked in by */}
          <Td
            className={tw(
              isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
            )}
          >
            {isPartiallyCheckedIn && partialCheckinDetails[item.id] ? (
              <span className="text-sm text-gray-600">
                {(() => {
                  const details = partialCheckinDetails[item.id];

                  return (
                    <UserBadge
                      name={resolveUserDisplayName(details.checkedInBy)}
                      img={details.checkedInBy.profilePicture}
                    />
                  );
                })()}
              </span>
            ) : (
              <EmptyTableValue />
            )}
          </Td>
        </>
      )}

      <Td
        className={tw(
          "pr-4 text-right",
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        <When truthy={canSeeActions}>
          <AssetRowActionsDropdown asset={item} />
        </When>
      </Td>
    </>
  );
}
