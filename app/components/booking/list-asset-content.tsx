import { useMemo } from "react";
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { BookingWithCustodians } from "~/modules/booking/types";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import {
  getBookingContextAssetStatus,
  isAssetPartiallyCheckedIn,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import { AvailabilityLabel } from "./availability-label";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { ListItemTagsColumn } from "../assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "../assets/category-badge";
import BulkListItemCheckbox from "../list/bulk-actions/bulk-list-item-checkbox";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import { EmptyTableValue } from "../shared/empty-table-value";
import { ReturnedBadge } from "../shared/returned-badge";
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
        !item.bookings.some((b) => b.id === booking.id) &&
        // Only exclude assets from current booking if current booking is ONGOING/OVERDUE
        !(
          booking.assets.some((asset) => asset.id === item.id) &&
          (booking.status === "ONGOING" || booking.status === "OVERDUE")
        )) ??
      false,
    [
      item.status,
      item.bookings,
      booking.id,
      booking.assets,
      item.id,
      booking.status,
    ]
  );

  const isPartOfKit = !!item.kitId;

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
  const contextStatus = getBookingContextAssetStatus(
    item,
    partialCheckinDetails,
    booking.status
  );
  const isPartiallyCheckedIn = isAssetPartiallyCheckedIn(
    item,
    partialCheckinDetails,
    booking.status
  );

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
              <div>
                {isFinished ? (
                  <ReturnedBadge />
                ) : (
                  <AssetStatusBadge
                    id={item.id}
                    status={contextStatus}
                    availableToBook={item.availableToBook}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
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
            {isPartiallyCheckedIn ? (
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
            {isPartiallyCheckedIn ? (
              <span className="text-sm text-gray-600">
                {(() => {
                  const details = partialCheckinDetails[item.id];
                  const firstName = details.checkedInBy.firstName || "";
                  const lastName = details.checkedInBy.lastName || "";

                  return (
                    <UserBadge
                      name={`${firstName} ${lastName}`}
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
