import { useMemo, useState } from "react";
import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";

/**
 * Type assertion helper for booking assets.
 * The loader enriches partial booking assets with full asset details via assetDetailsMap,
 * but TypeScript can't infer this enrichment. This helper documents the intentional
 * assertion and provides a single point of type conversion.
 */
function asEnrichedAssets<T>(assets: T[]): AssetWithBooking[] {
  return assets as unknown as AssetWithBooking[];
}

function asEnrichedAsset<T>(asset: T): AssetWithBooking {
  return asset as unknown as AssetWithBooking;
}
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
import { InfoTooltip } from "../shared/info-tooltip";
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
    const hasValidStatus =
      booking.status === BookingStatus.ONGOING ||
      booking.status === BookingStatus.OVERDUE ||
      booking.status === BookingStatus.COMPLETE ||
      booking.status === BookingStatus.ARCHIVED;
    const hasPartialCheckins = partialCheckinProgress?.hasPartialCheckins;
    // const isNotCheckedOutFilter =
    //   currentStatusFilter !== AssetStatus.CHECKED_OUT;

    return hasValidStatus && hasPartialCheckins;
    // && isNotCheckedOutFilter;
  }, [
    booking.status,
    partialCheckinProgress?.hasPartialCheckins,
    // searchParams,
  ]);

  const manageAssetsUrl = useMemo(
    () =>
      `manage-assets?${new URLSearchParams({
        bookingFrom: new Date(booking.from).toISOString(),
        bookingTo: new Date(booking.to).toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`,
    [booking.from, booking.to, booking.id]
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
      isCompleted || isArchived || isCancelled || cantManageAssetsAsBase
        ? {
            reason: isCompleted
              ? "Booking is completed. You cannot change the assets anymore"
              : isArchived
              ? "Booking is archived. You cannot change the assets anymore"
              : isCancelled
              ? "Booking is cancelled. You cannot change the assets anymore"
              : cantManageAssetsAsBase
              ? "You are unable to add assets at this point because the booking is already reserved. Cancel this booking and create another one if you need to make changes."
              : "You need to select a start and end date and save your booking before you can add assets to your booking",
          }
        : false,
    [isCompleted, isArchived, isCancelled, cantManageAssetsAsBase]
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
      .map((item) => {
        if (item?.type === "kit") {
          // For kits, return the kit's assets first, then the actual kit object
          // This matches what individual kit selection puts in the atom
          return [...item.assets, item.kit];
        } else {
          // For individual assets, return the asset
          return item.assets[0];
        }
      })
      .flat();
  }

  // Phase 3d: surface any outstanding model-level reservations in a
  // dedicated section above the asset filters. Rows where every unit
  // has been materialised into a concrete BookingAsset carry a
  // `fulfilledAt` timestamp and are hidden here — they're history,
  // not active work. The Models tab in manage-assets shows both
  // active and fulfilled rows for audit.
  const outstandingModelRequests = useMemo(
    () =>
      (booking.modelRequests ?? []).filter(
        (req: { fulfilledAt: Date | string | null }) => req.fulfilledAt === null
      ),
    [booking.modelRequests]
  );

  return (
    <div className="flex-1">
      <div className="w-full">
        <TextualDivider text="Assets & Kits" className="mb-8 lg:hidden" />
        <div className="mb-3 flex gap-4 lg:hidden"></div>

        {outstandingModelRequests.length > 0 ? (
          <ReservedModelsSection
            modelRequests={outstandingModelRequests}
            manageAssetsUrl={manageAssetsUrl}
            manageAssetsButtonDisabled={manageAssetsButtonDisabled}
          />
        ) : null}

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
                    <Th>Qty</Th>
                    <Th> </Th>
                    <Th>Category</Th>
                    <Th>Tags</Th>
                    {shouldShowCheckinColumns && (
                      <>
                        <Th className="whitespace-nowrap">
                          Checked in on{" "}
                          <InfoTooltip
                            iconClassName="size-4"
                            content={
                              <p>
                                Shows the date when the asset was checked in via
                                a partial check-in.
                              </p>
                            }
                          />
                        </Th>
                        <Th className="whitespace-nowrap">
                          Checked in by{" "}
                          <InfoTooltip
                            iconClassName="size-4"
                            content={
                              <p>
                                Shows the user who checked in the asset via a
                                partial check-in.
                              </p>
                            }
                          />
                        </Th>
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
                            assets={asEnrichedAssets(item.assets)}
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
                            item={asEnrichedAsset(asset)}
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
            Add assets
          </Button>
        </div>
      </When>
    </div>
  );
}

/**
 * Reserved models section (Phase 3d — Book-by-Model).
 *
 * Displays outstanding `BookingModelRequest` rows as a standalone block
 * above the filtered asset/kit list, so operators can see what's
 * reserved at the model level without opening the manage-assets modal.
 * Visual style mirrors the asset table header + list-container so it
 * sits comfortably alongside the existing Assets & Kits block.
 *
 * When the booking is in a state that accepts edits (controlled by
 * `manageAssetsButtonDisabled`), the header exposes a direct link to
 * the Models tab in manage-assets for quick adjustments.
 */
function ReservedModelsSection({
  modelRequests,
  manageAssetsUrl,
  manageAssetsButtonDisabled,
}: {
  modelRequests: Array<{
    id: string;
    assetModelId: string;
    quantity: number;
    fulfilledQuantity: number;
    fulfilledAt: Date | string | null;
    assetModel: { id: string; name: string };
  }>;
  manageAssetsUrl: string;
  manageAssetsButtonDisabled: BookingAssetsHeaderProps["manageAssetsButtonDisabled"];
}) {
  const totalUnits = useMemo(
    () =>
      modelRequests.reduce(
        (sum, req) => sum + (req.quantity - req.fulfilledQuantity),
        0
      ),
    [modelRequests]
  );

  return (
    <div className="mb-6">
      <div className="-mx-4 flex items-center justify-between border border-b-0 bg-white px-4 pb-3 pt-4 md:mx-0 md:rounded-t md:px-6">
        <div>
          <h5 className="text-left text-[16px] font-semibold text-gray-900">
            Reserved models ({totalUnits})
          </h5>
          <p className="text-sm text-gray-500">
            {modelRequests.length}{" "}
            {modelRequests.length === 1 ? "model" : "models"} reserved — use
            Scan to assign to attach specific assets now, or click Check out on
            the booking to fulfil and check out in one flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            to={`${manageAssetsUrl}&tab=models`}
            variant="secondary"
            size="sm"
            disabled={manageAssetsButtonDisabled}
            className="whitespace-nowrap"
          >
            Manage
          </Button>
          <Button
            to="scan-assets"
            icon="scan"
            variant="primary"
            size="sm"
            disabled={manageAssetsButtonDisabled}
            className="whitespace-nowrap"
          >
            Scan to assign
          </Button>
        </div>
      </div>
      <div className="-mx-4 overflow-x-auto border border-gray-200 bg-white md:mx-0 md:rounded-b">
        <table className="w-full border-collapse">
          <tbody>
            {modelRequests.map((req) => (
              <tr
                key={req.id}
                className="border-b border-gray-200 last:border-b-0"
              >
                <td className="px-6 py-3 text-sm font-medium text-gray-900">
                  {req.assetModel.name}
                </td>
                <td className="px-6 py-3 text-right text-sm tabular-nums text-gray-700">
                  × {req.quantity - req.fulfilledQuantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
