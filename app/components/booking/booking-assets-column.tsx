import React, { useMemo, useState } from "react";
import type { Kit } from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import type { SerializeFrom } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { BookingWithCustodians } from "~/modules/booking/types";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { tw } from "~/utils/tw";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import { AvailabilityLabel } from "./availability-label";
import KitRowActionsDropdown from "./kit-row-actions-dropdown";
import { AssetImage } from "../assets/asset-image";
import { AssetStatusBadge } from "../assets/asset-status-badge";
import { EmptyState } from "../list/empty-state";
import { ListHeader } from "../list/list-header";
import { ListItem } from "../list/list-item";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import TextualDivider from "../shared/textual-divider";
import { Table, Td, Th } from "../table";
import { BookingPagination } from "./booking-pagination";

export function BookingAssetsColumn() {
  const { booking, paginatedItems, totalPaginationItems } = useLoaderData<{
    booking: BookingWithCustodians;
    paginatedItems: Array<{
      type: "kit" | "asset";
      id: string;
      assets: any[];
      kit: SerializeFrom<Kit> | null;
    }>;
    totalPaginationItems: number;
  }>();

  const hasItems = paginatedItems?.length > 0;
  const { isBase } = useUserRoleHelper();
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
  const cantManageAssetsAsBase =
    isBase && booking.status !== BookingStatus.DRAFT;

  const [expandedKits, setExpandedKits] = useState<Record<string, boolean>>({});

  // Initially expand all kits
  useMemo(() => {
    const initialExpandState: Record<string, boolean> = {};
    paginatedItems.forEach((item) => {
      if (item.type === "kit") {
        initialExpandState[item.id] = false; // Kits are collapsed by default
      }
    });
    setExpandedKits(initialExpandState);
  }, [paginatedItems]);

  const toggleKitExpansion = (kitId: string) => {
    setExpandedKits((prev) => ({
      ...prev,
      [kitId]: !prev[kitId],
    }));
  };

  const manageAssetsButtonDisabled = useMemo(
    () =>
      !booking.from ||
      !booking.to ||
      isCompleted ||
      isArchived ||
      isCancelled ||
      cantManageAssetsAsBase
        ? {
            reason: isCompleted
              ? "Booking is completed. You cannot change the assets anymore"
              : isArchived
              ? "Booking is archived. You cannot change the assets anymore"
              : isCancelled
              ? "Booking is cancelled. You cannot change the assets anymore"
              : cantManageAssetsAsBase
              ? "You are unable to manage assets at this point because the booking is already reserved. Cancel this booking and create another one if you need to make changes."
              : "You need to select a start and end date and save your booking before you can add assets to your booking",
          }
        : false,
    [
      booking.from,
      booking.to,
      isCompleted,
      isArchived,
      isCancelled,
      cantManageAssetsAsBase,
    ]
  );

  return (
    <div className="flex-1">
      <div className=" w-full">
        <TextualDivider text="Assets" className="mb-8 lg:hidden" />
        <div className="mb-3 flex gap-4 lg:hidden"></div>
        <div className="flex flex-col">
          {/* This is a fake table header */}
          <div className="-mx-4 flex justify-between border border-b-0 bg-white p-4 text-left font-normal text-gray-600 md:mx-0 md:rounded-t md:px-6">
            <div>
              <div className=" text-md font-semibold text-gray-900">
                Assets & Kits
              </div>
              <div>
                <span>{totalPaginationItems} items</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                icon="scan"
                variant="secondary"
                to="scan-assets"
                disabled={manageAssetsButtonDisabled}
              >
                Scan
              </Button>
              <Button
                to={manageAssetsUrl}
                className="whitespace-nowrap"
                disabled={manageAssetsButtonDisabled}
              >
                Manage assets
              </Button>
            </div>
          </div>

          <div className="-mx-4 overflow-x-auto border border-b-0 border-gray-200 bg-white md:mx-0 md:rounded-b">
            {!hasItems ? (
              <EmptyState
                className="py-10"
                customContent={{
                  title: "Start by defining a booking period",
                  text: "Assets added to your booking will show up here. Scan tags or search for assets to add to your booking.",
                  newButtonRoute: manageAssetsUrl,
                  newButtonContent: "Manage assets",
                  buttonProps: {
                    disabled: manageAssetsButtonDisabled,
                  },
                }}
              />
            ) : (
              <>
                <Table className="border-collapse">
                  <ListHeader hideFirstColumn>
                    <Th>Name</Th>
                    <Th> </Th>
                    <Th>Category</Th>
                    <Th> </Th>
                  </ListHeader>
                  <tbody>
                    {/* Render paginated items (kits and individual assets) */}
                    {paginatedItems.map((item) => {
                      if (item.type === "kit") {
                        const kit = item.kit;
                        const isExpanded = expandedKits[item.id] ?? false;

                        return kit ? (
                          <React.Fragment key={`kit-${item.id}`}>
                            <ListItem
                              item={kit}
                              className="pseudo-border-bottom bg-gray-50"
                            >
                              <Td className="max-w-full">
                                <Button
                                  to={`/kits/${kit.id}`}
                                  variant="link"
                                  className="text-gray-900 hover:text-gray-700"
                                  target={"_blank"}
                                  onlyNewTabIconOnHover={true}
                                  aria-label="Go to kit"
                                >
                                  <div className="max-w-[200px] truncate sm:max-w-[250px] md:max-w-[350px] lg:max-w-[450px]">
                                    {kit.name}
                                  </div>
                                </Button>
                                <p className="text-sm text-gray-600">
                                  {item.assets.length} assets
                                </p>
                              </Td>

                              <Td> </Td>
                              <Td> </Td>

                              <Td className="pr-4 text-right align-middle">
                                <div className="flex items-center justify-end gap-5">
                                  <Button
                                    onClick={() => toggleKitExpansion(kit.id)}
                                    variant="link"
                                    className="text-center font-bold text-gray-600 hover:text-gray-900"
                                    aria-label="Toggle kit expand"
                                  >
                                    <ChevronDownIcon
                                      className={tw(
                                        `size-6 ${
                                          !isExpanded ? "rotate-180" : ""
                                        }`
                                      )}
                                    />
                                  </Button>

                                  {(!isBase && isDraft) || isReserved ? (
                                    <KitRowActionsDropdown kit={kit} />
                                  ) : null}
                                </div>
                              </Td>
                            </ListItem>

                            {isExpanded && (
                              <>
                                {item.assets.map((asset) => (
                                  <ListItem
                                    key={`kit-asset-${asset.id}`}
                                    item={asset}
                                    className="relative"
                                    motionProps={{
                                      initial: { opacity: 0, y: -10 },
                                      animate: { opacity: 1, y: 0 },
                                      exit: { opacity: 0, y: 10 },
                                      transition: {
                                        duration: 0.3,
                                        ease: "easeInOut",
                                      },
                                    }}
                                  >
                                    <ListAssetContent
                                      item={asset as AssetWithBooking}
                                      isKitAsset={true}
                                    />
                                  </ListItem>
                                ))}

                                {/* Add a separator row after the kit assets */}
                                <tr className="kit-separator h-1 bg-gray-100">
                                  <td colSpan={4} className="h-1 p-0"></td>
                                </tr>
                              </>
                            )}
                          </React.Fragment>
                        ) : null;
                      } else {
                        // Individual asset
                        const asset = item.assets[0];
                        return (
                          <ListItem key={`asset-${asset.id}`} item={asset}>
                            <ListAssetContent
                              item={asset as AssetWithBooking}
                            />
                          </ListItem>
                        );
                      }
                    })}
                  </tbody>
                </Table>
                <BookingPagination className="border-b" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ListAssetContent = ({
  item,
  isKitAsset = false,
}: {
  item: AssetWithBooking;
  isKitAsset?: boolean;
}) => {
  const { category } = item;
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isBase } = useUserRoleHelper();
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
      <Td className={tw("w-full whitespace-normal p-0 md:p-0")}>
        {isKitAsset && (
          <div className="absolute inset-y-0 left-0 h-full w-2 bg-gray-100" />
        )}
        <div
          className={tw(
            "flex justify-between gap-3 p-4 md:justify-normal md:px-6",
            isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className={tw(
                  "size-full rounded-[4px] border object-cover",
                  isKitAsset ? "border-gray-300" : ""
                )}
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover={true}
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
      </Td>

      {/* If asset status is different than available, we need to show a label */}
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {!isCompleted && !isArchived ? (
          <AvailabilityLabel asset={item} isCheckedOut={isCheckedOut} />
        ) : null}
      </Td>
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {category ? (
          <Badge color={category.color} withDot={false}>
            {category.name}
          </Badge>
        ) : null}
      </Td>
      <Td
        className={tw(
          "pr-4 text-right",
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {/* Base users can only remove assets if the booking is not started already */}
        {(isBase && (isOngoing || isOverdue || isReserved)) ||
        isPartOfKit ? null : (
          <AssetRowActionsDropdown asset={item} />
        )}
      </Td>
    </>
  );
};
