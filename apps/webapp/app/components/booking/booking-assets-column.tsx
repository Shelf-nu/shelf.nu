import { useMemo, useState } from "react";
import { BookingStatus } from "@prisma/client";
import { Package as PackageIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { BookingAssetsFilters } from "./booking-assets-filters";
import { BookingPagination } from "./booking-pagination";
import KitRow from "./kit-row";
import ListAssetContent from "./list-asset-content";
import ListBulkActionsDropdown from "./list-bulk-actions-dropdown";
import { ModelRequestRowActionsDropdown } from "./model-request-row-actions-dropdown";
import type { LoaderData } from "../list/bulk-actions/bulk-list-header";
import BulkListHeader from "../list/bulk-actions/bulk-list-header";
import { EmptyState } from "../list/empty-state";
import { ListHeader } from "../list/list-header";
import { ListItem } from "../list/list-item";
import ListTitle from "../list/list-title";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import { InfoTooltip } from "../shared/info-tooltip";
import TextualDivider from "../shared/textual-divider";
import { Table, Td, Th } from "../table";
import When from "../when/when";

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

export function BookingAssetsColumn() {
  const {
    userId,
    booking,
    items: paginatedItems,
    partialCheckinDetails,
    partialCheckinProgress,
  } = useLoaderData<BookingPageLoaderData>();
  // const [searchParams] = useSearchParams();

  // Count the actual content rendered in the table: concrete assets/kits
  // (paginated) + any outstanding model-level reservations. Without
  // counting model requests, a "book-by-model only" booking would fall
  // into the empty state and hide its reservations entirely.
  const hasItems =
    paginatedItems?.length > 0 ||
    (booking.modelRequests ?? []).some(
      (req: { fulfilledAt: Date | string | null }) => req.fulfilledAt === null
    );
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
                    {/* Outstanding model-level reservations render as
                        regular list rows at the top of the table so
                        operators see them alongside concrete assets/kits
                        with a distinguishing "Reserved model" label. See
                        {@link ModelRequestRow}. Fulfilled rows are
                        suppressed here — they live in the Models tab of
                        manage-assets as an audit trail. */}
                    {outstandingModelRequests.map((req) => (
                      <ModelRequestRow
                        key={`model-request-${req.id}`}
                        request={req}
                        bookingStatus={booking.status}
                        bookingId={booking.id}
                        shouldShowCheckinColumns={shouldShowCheckinColumns}
                        canScanToAssign={!manageAssetsButtonDisabled}
                      />
                    ))}

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
 * Single outstanding `BookingModelRequest` rendered as a row inside the
 * Assets & Kits list (Phase 3d — Book-by-Model).
 *
 * Uses the same table-cell structure as `KitRow` and the regular asset
 * row so model reservations live alongside concrete items rather than
 * in a separate Card above the list. The distinguishing affordances are:
 *
 *   - A neutral `Package` placeholder icon (no model image in the DB)
 *   - An amber "Reserved model" badge under the name
 *   - A `× N` quantity derived from `quantity - fulfilledQuantity` so
 *     partially-fulfilled requests show only the still-outstanding count
 *   - A right-column "Scan to assign" link visible on any manage-eligible
 *     status (DRAFT / RESERVED / ONGOING / OVERDUE). Routes to the
 *     generic scan-assets drawer; the checkout flow (with fulfil
 *     enforcement) still lives on the main Check Out button.
 *
 * The row is informational / actionable but **not selectable** — bulk
 * actions apply to concrete `BookingAsset` rows only. The bulk checkbox
 * cell is an empty spacer so the columns align with the rest of the
 * table.
 */
function ModelRequestRow({
  request,
  bookingStatus,
  bookingId,
  shouldShowCheckinColumns,
  canScanToAssign,
}: {
  request: {
    id: string;
    assetModelId: string;
    quantity: number;
    fulfilledQuantity: number;
    fulfilledAt: Date | string | null;
    assetModel: { id: string; name: string };
  };
  bookingStatus: BookingStatus;
  bookingId: string;
  shouldShowCheckinColumns: boolean;
  canScanToAssign: boolean;
}) {
  const remaining = Math.max(0, request.quantity - request.fulfilledQuantity);

  return (
    <tr className="relative border-b border-gray-200">
      {/* Bulk-select cell — empty because models aren't selectable as
          bulk items, but padded with the SAME `md:pl-4 md:pr-3` that
          `BulkListItemCheckbox` uses on asset/kit rows. Without this
          override, the cell inherits `Td`'s default `md:px-6` padding
          (~48px) and ends up ~20px wider than the bulk cell on asset
          rows — which shifts every subsequent column out of alignment
          with the other rows' columns. */}
      <Td className="md:pl-4 md:pr-3"> </Td>

      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex items-center gap-3 py-4 md:justify-normal md:pr-6">
          <div
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-gray-200 bg-gray-50"
          >
            <PackageIcon className="size-5 text-gray-400" />
          </div>
          <div className="min-w-0">
            <span className="block truncate font-medium text-gray-900">
              {request.assetModel.name}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge
                color={BADGE_COLORS.amber.bg}
                textColor={BADGE_COLORS.amber.text}
                withDot={false}
              >
                Reserved model
              </Badge>
              {request.fulfilledQuantity > 0 ? (
                <span className="text-xs text-gray-500">
                  {request.fulfilledQuantity} of {request.quantity} fulfilled
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Td>

      {/* Qty: outstanding units still needing assignment. Same
          `text-center` alignment as the asset-row qty cell so the
          column stays visually level row-to-row. */}
      <Td className="text-center text-sm tabular-nums text-gray-700">
        × {remaining}
      </Td>

      {/* Availability spacer — always empty for model rows */}
      <Td> </Td>

      {/* Category — models don't surface a category in this row (keeping
          the loader cheap; `assetModel` is included but without
          `defaultCategory`) */}
      <Td> </Td>

      {/* Tags — n/a for model rows */}
      <Td> </Td>

      {shouldShowCheckinColumns ? (
        <>
          <Td> </Td>
          <Td> </Td>
        </>
      ) : null}

      <Td className="pr-4 text-right align-middle">
        <ModelRequestRowActionsDropdown
          request={request}
          bookingId={bookingId}
          bookingStatus={bookingStatus}
          canManage={canScanToAssign}
        />
      </Td>
    </tr>
  );
}
