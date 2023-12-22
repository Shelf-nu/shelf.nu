import { useMemo } from "react";

import { BookingStatus } from "@prisma/client";
import { useLoaderData, useParams } from "@remix-run/react";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { AvailabilityLabel } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { ChevronRight } from "../icons";
import { List } from "../list";
import { Badge, Button } from "../shared";
import TextualDivider from "../shared/textual-divider";
import { ControlledActionButton } from "../subscription/premium-feature-button";
import { Td, Th } from "../table";

export function BookingAssetsColumn() {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();

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

  const isCompleted = useMemo(
    () => booking.status === BookingStatus.COMPLETE,
    [booking.status]
  );
  const isArchived = useMemo(
    () => booking.status === BookingStatus.ARCHIVED,
    [booking.status]
  );

  return (
    <div className="flex-1">
      <div className=" w-full">
        <TextualDivider text="Assets" className="mb-8 lg:hidden" />
        <div className="mb-3 flex gap-4 lg:hidden">
          <ControlledActionButton
            canUseFeature={
              !!booking.from && !!booking.to && !isCompleted && !isArchived
            }
            buttonContent={{
              title: "Manage Assets",
              message: isCompleted
                ? "Booking is completed. You cannot change the assets anymore"
                : "You need to select a start and end date and save your booking before you can add assets to your booking",
            }}
            buttonProps={{
              as: "button",
              to: manageAssetsUrl,
              icon: "plus",
              className: "whitespace-nowrap",
            }}
            skipCta={true}
          />
        </div>
        <div className="flex flex-col">
          {/* THis is a fake table header */}
          <div className="flex justify-between border border-b-0 bg-white p-4 text-left font-normal text-gray-600 md:mx-0 md:rounded-t-[12px] md:px-6">
            <div>
              <div className=" text-md font-semibold text-gray-900">Assets</div>
              <div>{booking.assets.length} items</div>
            </div>
            <ControlledActionButton
              canUseFeature={
                !!booking.from && !!booking.to && !isCompleted && !isArchived
              }
              buttonContent={{
                title: "Manage Assets",
                message: isCompleted
                  ? "Booking is completed. You cannot change the assets anymore"
                  : "You need to select a start and end date and save your booking before you can add assets to your booking",
              }}
              buttonProps={{
                as: "button",
                to: manageAssetsUrl,
                icon: "plus",
                className: "whitespace-nowrap",
              }}
              skipCta={true}
            />
          </div>
          <List
            ItemComponent={ListAssetContent}
            hideFirstHeaderColumn={true}
            headerChildren={
              <>
                <Th className="hidden md:table-cell">Name</Th>
                <Th className="hidden md:table-cell"> </Th>
                <Th className="hidden md:table-cell">Category</Th>
                <Th className="hidden md:table-cell"> </Th>
              </>
            }
            customEmptyStateContent={{
              title: "Start by defining a booking period",
              text: "Assets added to your booking will show up here. You must select a Start and End date in order to be able to add assets to your booking.",
              newButtonRoute: manageAssetsUrl,
              newButtonContent: "Manage Assets",
              buttonProps: {
                disabled: !booking.from || !booking.to,
              },
            }}
            className="md:rounded-t-[0px]"
          />
        </div>
      </div>
    </div>
  );
}

const ListAssetContent = ({ item }: { item: AssetWithBooking }) => {
  const { category } = item;
  const { bookindId } = useParams();
  const isChecked = item?.bookings?.some((b) => b.id === bookindId) ?? false;
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();

  const isCompleted = useMemo(
    () => booking.status === BookingStatus.COMPLETE,
    [booking.status]
  );
  const isArchived = useMemo(
    () => booking.status === BookingStatus.ARCHIVED,
    [booking.status]
  );

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="h-full w-full rounded-[4px] border object-cover"
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
              <div className="block md:hidden">
                {category ? (
                  <Badge color={category.color} withDot={false}>
                    {category.name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>

          <button className="block md:hidden">
            <ChevronRight />
          </button>
        </div>
      </Td>
      {/* If asset status is different than available, we need to show a label */}
      <Td>
        {!isCompleted && !isArchived ? (
          <AvailabilityLabel asset={item} isChecked={isChecked} />
        ) : null}
      </Td>
      <Td className="hidden md:table-cell">
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>
      <Td className="hidden pr-4 text-right md:table-cell">
        <AssetRowActionsDropdown asset={item} />
      </Td>
    </>
  );
};
