import React, { useMemo } from "react";
import type { Kit } from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { groupBy } from "~/utils/utils";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import { AvailabilityLabel } from "./availability-label";
import KitRowActionsDropdown from "./kit-row-actions-dropdown";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { EmptyState } from "../list/empty-state";
import { ListHeader } from "../list/list-header";
import { ListItem, type ListItemData } from "../list/list-item";
import { Pagination } from "../list/pagination";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import TextualDivider from "../shared/textual-divider";
import { Table, Td, Th } from "../table";

export function BookingAssetsColumn() {
  const { booking, items, totalItems } = useLoaderData<{
    booking: BookingWithCustodians;
    items: ListItemData[];
    totalItems: number;
  }>();
  const hasItems = items?.length > 0;
  const isSelfService = useUserIsSelfService();
  const { isDraft, isReserved, isCompleted, isArchived, isCancelled } =
    useBookingStatusHelpers(booking);

  const manageAssetsUrl = useMemo(
    () =>
      `add-assets?${new URLSearchParams({
        // We force the as String because we know that the booking.from and booking.to are strings and exist at this point.
        // This button wouldnt be available at all if there is no booking.from and booking.to
        bookingFrom: new Date(booking.from as string).toISOString(),
        bookingTo: new Date(booking.to as string).toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`,
    [booking]
  );

  // Self service can only manage assets for bookings that are DRAFT
  const cantManageAssetsAsSelfService =
    isSelfService && booking.status !== BookingStatus.DRAFT;

  const { assetsWithoutKits, groupedAssetsWithKits } = useMemo(
    () => ({
      assetsWithoutKits: items.filter((item) => !item.kitId),
      groupedAssetsWithKits: groupBy(
        items.filter((item) => !!item.kitId),
        (item) => item.kitId
      ),
    }),
    [items]
  );

  const canManageAssets = canUserManageBookingAssets(booking, isSelfService);

  const manageAssetsDisabled = !canManageAssets
    ? {
        reason: isCompleted
          ? "Booking is completed. You cannot change the assets anymore"
          : isArchived
          ? "Booking is archived. You cannot change the assets anymore"
          : isCancelled
          ? "Booking is cancelled. You cannot change the assets anymore"
          : cantManageAssetsAsSelfService
          ? "You are unable to manage assets at this point because the booking is already reserved. Cancel this booking and create another one if you need to make changes."
          : "You need to select a start and end date and save your booking before you can add assets to your booking",
      }
    : false;

  return (
    <div className="flex-1">
      <div className=" w-full">
        <TextualDivider text="Assets" className="mb-8 lg:hidden" />
        <div className="mb-3 flex gap-4 lg:hidden"></div>
        <div className="flex flex-col">
          {/* THis is a fake table header */}
          <div className="-mx-4 flex justify-between border border-b-0 bg-white p-4 text-left font-normal text-gray-600 md:mx-0 md:rounded-t md:px-6">
            <div>
              <div className=" text-md font-semibold text-gray-900">Assets</div>
              <div>{totalItems} items</div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                icon="scan"
                to="scan-assets"
                variant="outline"
                disabled={manageAssetsDisabled}
              >
                Scan
              </Button>

              <Button
                to={manageAssetsUrl}
                className="whitespace-nowrap"
                disabled={manageAssetsDisabled}
              >
                Manage assets
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto border border-b-0 border-gray-200 bg-white md:mx-0 md:rounded-b">
            {!hasItems ? (
              <EmptyState
                className="py-10"
                customContent={{
                  title: "Start by defining a booking period",
                  text: "Assets added to your booking will show up here. You must select a Start and End date and Save your booking in order to be able to add assets.",
                  newButtonRoute: manageAssetsUrl,
                  newButtonContent: "Manage assets",
                  buttonProps: {
                    disabled: !booking.from || !booking.to,
                  },
                }}
              />
            ) : (
              <>
                <Table>
                  <ListHeader hideFirstColumn>
                    <Th>Name</Th>
                    <Th> </Th>
                    <Th>Category</Th>
                    <Th> </Th>
                  </ListHeader>
                  <tbody>
                    {/* List all assets without kit at once */}
                    {assetsWithoutKits.map((asset) => (
                      <ListItem key={asset.id} item={asset}>
                        <ListAssetContent item={asset as AssetWithBooking} />
                      </ListItem>
                    ))}

                    {/* List all the assets which are part of a kit */}
                    {Object.values(groupedAssetsWithKits).map((assets) => {
                      const kit = assets[0].kit as Kit;

                      return (
                        <React.Fragment key={kit.id}>
                          <ListItem item={kit} className="bg-gray-50">
                            <Td className="w-full">
                              <Button
                                to={`/kits/${kit.id}`}
                                variant="link"
                                className="text-gray-900 hover:text-gray-700"
                              >
                                {kit.name}
                              </Button>

                              <p className="text-sm text-gray-600">
                                {assets.length} assets
                              </p>
                            </Td>

                            <Td> </Td>
                            <Td> </Td>

                            <Td className="pr-4 text-right">
                              {(!isSelfService && isDraft) || isReserved ? (
                                <KitRowActionsDropdown kit={kit} />
                              ) : null}
                            </Td>
                          </ListItem>

                          {assets.map((asset) => (
                            <ListItem key={asset.id} item={asset}>
                              <ListAssetContent
                                item={asset as AssetWithBooking}
                              />
                            </ListItem>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </Table>
                <Pagination className="border-b" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ListAssetContent = ({ item }: { item: AssetWithBooking }) => {
  const { category } = item;
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const isSelfService = useUserIsSelfService();
  const { isOngoing, isCompleted, isArchived, isOverdue, isReserved } =
    useBookingStatusHelpers(booking);

  /** Weather the asset is checked out in a booking different than the current one */
  const isCheckedOut = useMemo(
    () =>
      (item.status === AssetStatus.CHECKED_OUT &&
        !item.bookings.some((b) => b.id === booking.id)) ??
      false,
    [item.status, item.bookings, booking.id]
  );

  const isPartOfKit = !!item.kitId;

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-start md:gap-0">
              <div className="min-w-[130px]">
                <span className="word-break mb-1 block font-medium">
                  <Button
                    to={`/assets/${item.id}`}
                    variant="link"
                    className="text-gray-900 hover:text-gray-700"
                  >
                    {item.title}
                  </Button>
                </span>
                <div>
                  <AssetStatusBadge
                    status={item.status}
                    availableToBook={item.availableToBook}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Td>
      {/* If asset status is different than available, we need to show a label */}
      <Td>
        {!isCompleted && !isArchived ? (
          <AvailabilityLabel asset={item} isCheckedOut={isCheckedOut} />
        ) : null}
      </Td>
      <Td className="">
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>
      <Td className="pr-4 text-right">
        {/* Self Service can only remove assets if the booking is not started already */}
        {(isSelfService && (isOngoing || isOverdue || isReserved)) ||
        isPartOfKit ? null : (
          <AssetRowActionsDropdown asset={item} />
        )}
      </Td>
    </>
  );
};
