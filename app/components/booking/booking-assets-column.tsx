import { useMemo, useState } from "react";
import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.manage-assets";
import KitRow from "./kit-row";
import ListAssetContent from "./list-asset-content";
import ListBulkActionsDropdown from "./list-bulk-actions-dropdown";
import BulkListHeader from "../list/bulk-actions/bulk-list-header";
import { EmptyState } from "../list/empty-state";
import { ListHeader } from "../list/list-header";
import { ListItem } from "../list/list-item";
import { Button } from "../shared/button";
import TextualDivider from "../shared/textual-divider";
import { Table, Th } from "../table";
import { BookingPagination } from "./booking-pagination";
import When from "../when/when";

export function BookingAssetsColumn() {
  const { userId, booking, paginatedItems, totalPaginationItems } =
    useLoaderData<BookingPageLoaderData>();

  const hasItems = paginatedItems?.length > 0;
  const { isBase, isSelfService, isBaseOrSelfService } = useUserRoleHelper();
  const { isCompleted, isArchived, isCancelled } = useBookingStatusHelpers(
    booking.status
  );

  const manageAssetsUrl = useMemo(
    () =>
      `manage-assets?${new URLSearchParams({
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
    (isBase || isSelfService) && booking.status !== BookingStatus.DRAFT;

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

  /**
   * Check whether the user can see actions
   * 1. Admin/Owner always can see all
   * 2. SELF_SERVICE can see actions if they are the custodian of the booking
   * 3. BASE can see actions if they are the custodian of the booking
   */

  const canSeeActions =
    !isBaseOrSelfService ||
    (isBaseOrSelfService && booking?.custodianUser?.id === userId);

  return (
    <div className="flex-1">
      <div className="w-full">
        <TextualDivider text="Assets & Kits" className="mb-8 lg:hidden" />
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

            <When truthy={canSeeActions}>
              <div className="flex items-center gap-2">
                <ListBulkActionsDropdown />
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
            </When>
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
                    <BulkListHeader
                      itemsGetter={(data) =>
                        data.paginatedItems
                          .map((item) => [
                            item,
                            ...(item?.type === "kit" ? item.assets : []),
                          ])
                          .flat()
                      }
                    />
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

                        if (!kit) {
                          return null;
                        }

                        return (
                          <KitRow
                            key={`kit-${item.id}`}
                            bookingId={booking.id}
                            kit={kit}
                            isExpanded={isExpanded}
                            onToggleExpansion={toggleKitExpansion}
                            bookingStatus={booking.status}
                            assets={item.assets as AssetWithBooking[]}
                          />
                        );
                      }

                      // Individual asset
                      const asset = item.assets[0];
                      return (
                        <ListItem key={`asset-${asset.id}`} item={asset}>
                          <ListAssetContent item={asset as AssetWithBooking} />
                        </ListItem>
                      );
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
