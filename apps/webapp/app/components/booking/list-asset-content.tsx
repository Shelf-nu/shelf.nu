import { useMemo } from "react";
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { LocationBadge } from "~/components/location/location-badge";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isQuantityTracked } from "~/modules/asset/utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import type {
  PartialCheckinDetailsType,
  PartialCheckoutDetailsType,
} from "~/modules/booking/service.server";
import type { BookingWithCustodians } from "~/modules/booking/types";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import {
  isAssetPartiallyCheckedIn,
  resolveBookingRowQtyState,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";
import {
  AvailabilityLabel,
  InsufficientStockBadge,
} from "./availability-label";
import { AssetCodeBadge } from "../assets/asset-code-badge";
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
  /** Per-asset partial check-OUT details (date + user) keyed by asset id. */
  partialCheckoutDetails: PartialCheckoutDetailsType;
  /** Whether the "Checked out on/by" columns should render. */
  shouldShowCheckoutColumns: boolean;
};

export default function ListAssetContent({
  item,
  isKitAsset,
  partialCheckinDetails,
  shouldShowCheckinColumns,
  partialCheckoutDetails,
  shouldShowCheckoutColumns,
}: ListAssetContentProps) {
  const { category, tags } = item;
  /**
   * `availableUnitsByAsset` is the workspace-availability map shipped by
   * the booking-overview loader (`bookings.$bookingId.overview.tsx`).
   * Keyed by `assetId`, scalar = units free across the workspace pool
   * (after subtracting operator custody + other-booking reservations +
   * active checkouts elsewhere). Drives the `InsufficientStockBadge`
   * branch below. `?? {}` keeps the older `bookings._index.tsx` and other
   * callers that don't surface the map working — the lookup just returns
   * `undefined` and the badge condition short-circuits.
   */
  const { booking, availableUnitsByAsset } = useLoaderData<{
    booking: BookingWithCustodians;
    availableUnitsByAsset?: Record<string, number>;
  }>();
  const currentOrganization = useCurrentOrganization();
  const { isBase, isSelfService, isBaseOrSelfService } = useUserRoleHelper();

  // Resolve the asset's display code (QR id, SAM id, or barcode value) per
  // the workspace preference and per-asset override. Cheap pure call; safe
  // inline. Renders nothing if the asset lacks the necessary related fields.
  const displayCode = currentOrganization
    ? resolveDisplayCode({
        entity: item,
        organization: currentOrganization,
      })
    : null;
  const { isReserved, isDraft, isFinished } = useBookingStatusHelpers(
    booking.status
  );
  const user = useUserData();

  /**
   * Whether the asset is checked out in a booking different than the
   * current one. Drives the legacy amber "Checked out" badge in
   * `AvailabilityLabel`.
   *
   * Short-circuits to `false` for QT assets: a fungible-units asset can
   * be "checked out elsewhere" while still having free units available
   * across the workspace pool, so the global CHECKED_OUT-elsewhere
   * signal is meaningless for QT. The new `InsufficientStockBadge`
   * (driven by `availableUnitsByAsset`) is the actionable replacement —
   * it fires when the booked qty exceeds workspace headroom regardless
   * of where the missing units happen to be.
   */
  const isCheckedOut = useMemo(() => {
    if (isQuantityTracked(item)) return false;
    return (
      (item.status === AssetStatus.CHECKED_OUT &&
        !item.bookingAssets.some((ba) => ba.booking.id === booking.id) &&
        // Only exclude assets from current booking if current booking is ONGOING/OVERDUE
        !(
          booking.bookingAssets.some(
            (ba: { assetId: string }) => ba.assetId === item.id
          ) &&
          (booking.status === "ONGOING" || booking.status === "OVERDUE")
        )) ??
      false
    );
  }, [item, booking.id, booking.bookingAssets, booking.status]);

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

  /**
   * Qty-tracked partial dispositioning.
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
  /**
   * Per-row units that have been progressively checked OUT via
   * `PartialBookingCheckout`. Shipped by the overview loader keyed by
   * `bookingAssetId`, so multi-row slices of the same asset are
   * accounted independently. Drives the new "partially checked out, no
   * returns yet" branches (badge + Qty cell display) below.
   */
  const qtyCheckedOut = item.checkedOutQuantity ?? 0;
  /**
   * How many units of this row are booked but NOT yet checked out.
   * Surfaced in the pending-return tooltip so the operator can see
   * what's still owed on the out-side before any return activity.
   */
  const qtyOutstandingCheckout = Math.max(0, qtyBooked - qtyCheckedOut);
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
  /**
   * Per-row (per-`bookingAssetId`) status resolution. With multi-row slices an
   * asset can have its kit-driven slice fully reconciled while a parallel
   * standalone slice is still partly out, so the badge needs the state of THIS
   * row, not the asset's global rollup. Resolved via the SHARED
   * `resolveBookingRowQtyState` so this badge and the status-sort predicate
   * (`shape-booking-assets.ts`) use identical logic and can never disagree —
   * `contextStatus` is exactly the bucket the status sort reads. The
   * destructured QT flags feed `isPartiallyCheckedIn` below.
   */
  const { contextStatus, isQtyFullyCheckedIn, isQtyPartiallyCheckedIn } =
    resolveBookingRowQtyState(item, partialCheckinDetails, booking.status);

  /**
   * Workspace-availability lookup for this row's asset. `undefined` when
   * the loader doesn't ship the map (e.g. the legacy bookings index path
   * uses this component too) — in which case the insufficient-stock
   * check below short-circuits to `false` and the badge never renders.
   */
  const availableUnits = availableUnitsByAsset?.[item.id];

  /**
   * Per-row "insufficient stock" signal. Fires when this booking's row
   * reserves more units than are available across the workspace pool
   * (`availableUnits`), and the booking is still active enough to act on
   * the signal. Gated on:
   *
   *  - `isQuantityTracked(item)` — INDIVIDUAL assets have their own
   *    AvailabilityBadge paths and never get this badge.
   *  - `availableUnits != null` — only fires when the loader actually
   *    shipped a value (avoids false positives on routes that don't
   *    surface workspace-availability).
   *  - `qtyBooked > availableUnits` — strict inequality; at-capacity is
   *    NOT a problem.
   *  - `booking.status !== "COMPLETE" && booking.status !== "ARCHIVED"`
   *    — once the booking is historical the stock signal is stale and
   *    should not surface; nothing actionable remains.
   *
   * Each row evaluates independently: a multi-row asset can have
   * multiple slices and each row's `bookedQuantity` is compared to the
   * SAME per-asset global headroom, so multiple rows can each light up
   * the badge.
   */
  const hasInsufficientStock =
    isQuantityTracked(item) &&
    availableUnits != null &&
    qtyBooked > availableUnits &&
    booking.status !== "COMPLETE" &&
    booking.status !== "ARCHIVED";

  // Per-asset partial check-OUT record (if any). Presence of a record drives
  // the "Checked out on/by" cell content for this asset.
  const checkoutDetails = partialCheckoutDetails[item.id];

  // An asset only "returned" if it was actually checked out. When the booking
  // used progressive checkout, partialCheckoutDetails identifies the checked-out
  // assets; when it has no checkout records (quick/all-at-once checkout), every
  // asset was checked out.
  const hasProgressiveCheckout = Object.keys(partialCheckoutDetails).length > 0;
  const wasCheckedOut =
    !hasProgressiveCheckout || Boolean(partialCheckoutDetails[item.id]);

  const isPartiallyCheckedIn =
    isQtyFullyCheckedIn ||
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
              {/*
                Single metadata line under the title: status (returned/active)
                first as the most glanceable cue, code chip after as the
                identification reference. `flex-wrap` keeps long codes safe on
                narrow viewports.
              */}
              <div className="flex flex-wrap items-center gap-2">
                {isFinished && wasCheckedOut ? (
                  <ReturnedBadge />
                ) : (
                  <AssetStatusBadge
                    id={item.id}
                    status={contextStatus}
                    availableToBook={item.availableToBook}
                    asset={item}
                    // For QT rows the resolved `contextStatus` already encodes
                    // the booking-context truth (AVAILABLE via
                    // `getBookingContextAssetStatus` for DRAFT/RESERVED, or
                    // our partial pseudo-statuses for in-flight reconciliation).
                    // Suppress the global qty-aware breakdown override so the
                    // badge renders that resolved status verbatim — the new
                    // `InsufficientStockBadge` carries the workspace-pool
                    // signal that the global breakdown used to carry here.
                    suppressQtyAware={isQuantityTracked(item)}
                  />
                )}
                {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
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
          shows just the booked total until there's check-OUT or
          check-IN activity. Three progress modes (mutually exclusive,
          disposition wins):
            1. `qtyDispositioned > 0` — returns are underway. Shows
               `dispositioned / booked` (gray, or emerald when full)
               with the per-category breakdown tooltip.
            2. `qtyCheckedOut > 0 && qtyDispositioned === 0` — units
               are progressively checked OUT with nothing back yet.
               Shows `checkedOut / booked` in amber-700 (matches the
               new `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` badge)
               with a simpler "Partially checked out" tooltip.
            3. Otherwise — plain booked count, no progress display. */}
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
          ) : qtyCheckedOut > 0 && qtyCheckedOut < qtyBooked ? (
            // Progressive checkout in flight, no returns yet. Mirrors
            // the disposition tooltip's structure but counts the
            // OUT-side: `checkedOut / booked` in amber to match the
            // `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` badge. No
            // breakdown rows here (qtyDispositioned === 0 by branch
            // guard, so returned/consumed/lost/damaged are all 0).
            // Upper guard `qtyCheckedOut < qtyBooked` matches the badge:
            // when ALL booked units are out (25/25), the asset status is
            // already CHECKED_OUT and the row falls through to the plain
            // booked-total display below — paired with the violet
            // "Checked out" status badge above.
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1 tabular-nums text-amber-700">
                    <span className="font-medium">{qtyCheckedOut}</span>
                    <span className="text-gray-400">/ {qtyBooked}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="max-w-xs">
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="font-semibold text-gray-900">
                      Partially checked out
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-600">Checked out</span>
                      <span className="tabular-nums text-amber-700">
                        {qtyCheckedOut} / {qtyBooked}
                      </span>
                    </div>
                    {qtyOutstandingCheckout > 0 ? (
                      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1">
                        <span className="text-gray-600">
                          Still to check out
                        </span>
                        <span className="font-medium tabular-nums text-gray-900">
                          {qtyOutstandingCheckout}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="tabular-nums">{qtyBooked}</span>
          )
        ) : null}
      </Td>

      {/* If asset status is different than available, we need to show a label.
          Also surfaces the QT-only `InsufficientStockBadge` when the row's
          booked qty exceeds workspace headroom — INDIVIDUAL assets stay on
          the existing `AvailabilityLabel` paths and never reach the badge. */}
      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {!isFinished ? (
          <div className="flex flex-wrap items-center gap-1">
            <AvailabilityLabel asset={item} isCheckedOut={isCheckedOut} />
            {hasInsufficientStock ? (
              <InsufficientStockBadge
                bookedQuantity={qtyBooked}
                availableUnits={availableUnits ?? 0}
              />
            ) : null}
          </div>
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

      <Td
        className={tw(
          isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
        )}
      >
        {item.location ? (
          <LocationBadge
            location={{
              id: item.location.id,
              name: item.location.name,
              parentId: item.location.parentId ?? undefined,
              childCount: item.location._count?.children ?? 0,
            }}
          />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      {shouldShowCheckoutColumns && (
        <>
          {/* Checked out on */}
          <Td
            className={tw(
              isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
            )}
          >
            {checkoutDetails ? (
              <span className="text-sm text-gray-600">
                <DateS date={checkoutDetails.checkoutDate} includeTime />
              </span>
            ) : (
              <EmptyTableValue />
            )}
          </Td>

          {/* Checked out by */}
          <Td
            className={tw(
              isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
            )}
          >
            {checkoutDetails ? (
              <span className="text-sm text-gray-600">
                <UserBadge
                  name={resolveUserDisplayName(checkoutDetails.checkedOutBy)}
                  img={checkoutDetails.checkedOutBy.profilePicture}
                />
              </span>
            ) : (
              <EmptyTableValue />
            )}
          </Td>
        </>
      )}

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
