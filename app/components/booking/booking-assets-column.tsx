import { useMemo, useState } from "react";
import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.manage-assets";
import { BookingAssetsFilters } from "./booking-assets-filters";
import KitRow from "./kit-row";
import ListAssetContent from "./list-asset-content";
import ListBulkActionsDropdown from "./list-bulk-actions-dropdown";
import type { LoaderData } from "../list/bulk-actions/bulk-list-header";
import BulkListHeader from "../list/bulk-actions/bulk-list-header";
import { EmptyState } from "../list/empty-state";
import { ListHeader } from "../list/list-header";
import { ListItem } from "../list/list-item";
import ListTitle from "../list/list-title";
import { Button } from "../shared/button";
import TextualDivider from "../shared/textual-divider";
import { Table, Th } from "../table";
import { BookingPagination } from "./booking-pagination";
import When from "../when/when";

export function BookingAssetsColumn() {
  const {
    userId,
    booking,
    items: paginatedItems,
    partialCheckinDetails,
    partialCheckinProgress,
  } = useLoaderData<BookingPageLoaderData>();
  // const [searchParams] = useSearchParams();

  const hasItems = paginatedItems?.length > 0;
  const { isBase, isSelfService, isBaseOrSelfService } = useUserRoleHelper();
  const { isCompleted, isArchived, isCancelled } = useBookingStatusHelpers(
    booking.status
  );

  // Determine if we should show the check-in columns
  const shouldShowCheckinColumns = useMemo(() => {
    // const currentStatusFilter = searchParams.get("status");
    const isOngoing =
      booking.status === BookingStatus.ONGOING ||
      booking.status === BookingStatus.OVERDUE;
    const hasPartialCheckins = partialCheckinProgress?.hasPartialCheckins;
    // const isNotCheckedOutFilter =
    //   currentStatusFilter !== AssetStatus.CHECKED_OUT;

    return isOngoing && hasPartialCheckins;
    // && isNotCheckedOutFilter;
  }, [
    booking.status,
    partialCheckinProgress?.hasPartialCheckins,
    // searchParams,
  ]);

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

  function itemsGetter(data: LoaderData) {
    return data.items
      .map((item) => [item, ...(item?.type === "kit" ? item.assets : [])])
      .flat();
  }

  return (
    <div className="flex-1">
      <div className="w-full">
        <TextualDivider text="Assets & Kits" className="mb-8 lg:hidden" />
        <div className="mb-3 flex gap-4 lg:hidden"></div>
        <div className="flex flex-col">
          {/* Filters */}
          <div className="mb-2">
            <BookingAssetsFilters />
          </div>

          {/* This is a fake table header */}
          <div className="-mx-4 border border-b-0 bg-white px-4 pb-3 pt-4 text-left font-normal text-gray-600 md:mx-0 md:rounded-t ">
            <BookingAssetsHeader
              canSeeActions={canSeeActions}
              itemsGetter={itemsGetter}
              manageAssetsUrl={manageAssetsUrl}
              manageAssetsButtonDisabled={manageAssetsButtonDisabled}
            />
          </div>

          <div className="-mx-4 overflow-x-auto border border-b-0 border-gray-200 bg-white md:mx-0 md:rounded-b">
            {!hasItems ? (
              <EmptyState
                className="py-10"
                customContent={{
                  title: "Start by defining a booking period",
                  text: "Assets added to your booking will show up here. Scan tags or search for assets to add to your booking.",
                  newButtonRoute: manageAssetsUrl,
                  newButtonContent: "Add assets",
                  buttonProps: {
                    disabled: manageAssetsButtonDisabled,
                  },
                }}
              />
            ) : (
              <>
                <Table className="border-collapse">
                  <ListHeader hideFirstColumn>
                    <BulkListHeader itemsGetter={itemsGetter} />
                    <Th>Name</Th>
                    <Th> </Th>
                    <Th>Category</Th>
                    {shouldShowCheckinColumns && (
                      <>
                        <Th className="whitespace-nowrap">Checked in on</Th>
                        <Th className="whitespace-nowrap">Checked in by</Th>
                      </>
                    )}
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
                            partialCheckinDetails={partialCheckinDetails}
                            shouldShowCheckinColumns={shouldShowCheckinColumns}
                          />
                        );
                      }

                      // Individual asset
                      const asset = item.assets[0];
                      return (
                        <ListItem key={`asset-${asset.id}`} item={asset}>
                          <ListAssetContent
                            item={asset as AssetWithBooking}
                            partialCheckinDetails={partialCheckinDetails}
                            shouldShowCheckinColumns={shouldShowCheckinColumns}
                          />
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

interface BookingAssetsHeaderProps {
  canSeeActions: boolean;
  itemsGetter: (data: any) => any[];
  manageAssetsUrl: string;
  manageAssetsButtonDisabled: any;
}

function BookingAssetsHeader({
  canSeeActions,
  itemsGetter,
  manageAssetsUrl,
  manageAssetsButtonDisabled,
}: BookingAssetsHeaderProps) {
  const { isMd } = useViewportHeight();
  // const [searchParams] = useSearchParams();
  // const statusFilter = searchParams.get("status");

  // const title = useMemo(() => {
  //   switch (statusFilter) {
  //     case "AVAILABLE":
  //       return "Available Assets & Kits";
  //     case "CHECKED_OUT":
  //       return "Checked out Assets & Kits";
  //     default:
  //       return "Assets & Kits";
  //   }
  // }, [statusFilter]);

  if (isMd) {
    // Desktop layout: everything in one row
    return (
      <div className="flex justify-between">
        <ListTitle
          title={"Assets & Kits"}
          titleClassName="text-transform normal-case"
          hasBulkActions
          itemsGetter={itemsGetter}
          disableSelectAllItems
        />

        <When truthy={canSeeActions}>
          <div className="flex items-center gap-2">
            <ListBulkActionsDropdown />
            <Button
              icon="scan"
              variant="secondary"
              to="scan-assets"
              disabled={manageAssetsButtonDisabled}
            >
              Scan to add
            </Button>
            <Button
              to={manageAssetsUrl}
              className="whitespace-nowrap"
              disabled={manageAssetsButtonDisabled}
            >
              Add assets
            </Button>
          </div>
        </When>
      </div>
    );
  }

  // Mobile layout: two rows
  return (
    <div>
      {/* First row: ListTitle and ListBulkActionsDropdown */}
      <div className="flex items-start justify-between">
        <ListTitle
          title="Assets & Kits"
          hasBulkActions
          itemsGetter={itemsGetter}
          disableSelectAllItems
        />
        <When truthy={canSeeActions}>
          <ListBulkActionsDropdown />
        </When>
      </div>

      {/* Second row: Scan and Manage assets buttons */}
      <When truthy={canSeeActions}>
        <div className="flex gap-2">
          <Button
            icon="scan"
            variant="secondary"
            to="scan-assets"
            disabled={manageAssetsButtonDisabled}
            className="flex-1"
          >
            Scan
          </Button>
          <Button
            to={manageAssetsUrl}
            className="flex-1 whitespace-nowrap"
            disabled={manageAssetsButtonDisabled}
          >
            Manage assets
          </Button>
        </div>
      </When>
    </div>
  );
}
