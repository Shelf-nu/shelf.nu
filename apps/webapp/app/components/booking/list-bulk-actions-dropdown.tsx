import { useMemo, useState } from "react";
import { BookingStatus } from "@prisma/client";
import { useAtomValue } from "jotai";
import { ChevronRight, PackageCheck, PackageMinus } from "lucide-react";
import { useLoaderData } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithStatus } from "~/utils/booking-assets";
import {
  flattenSelectedBookingItems,
  isAssetCheckableIn,
  isAssetCheckableOut,
  isAssetPartiallyCheckedIn,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import BulkPartialCheckinDialog from "./bulk-partial-checkin-dialog";
import BulkPartialCheckoutDialog from "./bulk-partial-checkout-dialog";
import BulkRemoveAssetAndKitDialog from "./bulk-remove-asset-and-kit-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";

export default function ListBulkActionsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button variant="secondary" to="#">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return (
    <div className="actions-dropdown flex">
      <ConditionalDropdown />
    </div>
  );
}

function ConditionalDropdown() {
  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const {
    booking,
    partialCheckinDetails = {},
    checkedOutAssetIds = [],
    remainingToCheckOutByAsset = {},
  } = useLoaderData<BookingPageLoaderData>();
  const bookingStatus = useBookingStatusHelpers(
    booking.status as BookingStatus
  );
  const actionsButtonDisabled = selectedItems.length === 0;

  // Show partial check-in only for ONGOING/OVERDUE bookings.
  const showPartialCheckin =
    bookingStatus?.isOngoing || bookingStatus?.isOverdue;

  // Show partial check-out for RESERVED/ONGOING/OVERDUE bookings. Unlike
  // check-in, checkout can START from a RESERVED booking.
  const showPartialCheckout =
    bookingStatus?.isReserved ||
    bookingStatus?.isOngoing ||
    bookingStatus?.isOverdue;

  // Finished = COMPLETE/ARCHIVED. Computed directly from status: the helper's
  // `isFinished` flag isn't present on its undefined-status return shape, and a
  // direct compare matches how the rest of the booking UI checks status.
  const isFinished =
    booking.status === BookingStatus.COMPLETE ||
    booking.status === BookingStatus.ARCHIVED;

  // Denormalised view of `booking.bookingAssets` (the QT pivot). Project the
  // pivot rows down to the plain asset shape the shared resolver
  // (`flattenSelectedBookingItems`) was authored against — `booking.assets`
  // no longer exists post-pivot. Mirrors the projection used by both
  // bulk-partial dialogs so all three call sites stay in lock-step.
  const assetsList = useMemo(
    () =>
      booking.bookingAssets.map((ba) => {
        // Post-Phase-4a pivot: kit membership lives on `asset.assetKits[]`,
        // matched via `ba.assetKitId`. Standalone rows leave kit/kitId null.
        const matchedAssetKit = ba.assetKitId
          ? ba.asset.assetKits?.find((ak) => ak.id === ba.assetKitId) ?? null
          : null;
        return {
          ...ba.asset,
          bookingAssetId: ba.id,
          // `?? 1` defends test fixtures that omit BookingAsset.quantity
          // from overwriting a caller-supplied bookedQuantity with
          // `undefined` when this object is spread downstream.
          bookedQuantity: ba.quantity ?? 1,
          kitId: matchedAssetKit?.kitId ?? null,
          kit: matchedAssetKit?.kit ?? null,
        };
      }),
    [booking.bookingAssets]
  );

  // Resolve the selection to enriched asset rows (kits excluded) with the SAME
  // resolver the dialogs use, so the dropdown's enable/disable state can never
  // disagree with what a dialog would actually act on.
  const selectedAssets = flattenSelectedBookingItems(
    selectedItems,
    assetsList
  ).filter((item) => item.title && !item._count);

  const checkedOutIdsSet = new Set(checkedOutAssetIds);

  // How many selected assets each action can act on.
  const checkInEligibleCount = selectedAssets.filter((asset) =>
    isAssetCheckableIn(
      asset as AssetWithStatus,
      partialCheckinDetails,
      booking.status
    )
  ).length;
  // QT-aware top-off: pass the per-booking remaining map so QUANTITY_TRACKED
  // assets stay eligible while units remain, even if some are already out.
  // Falls back to the binary check for INDIVIDUAL rows / legacy loaders.
  const checkOutEligibleCount = selectedAssets.filter((asset) =>
    isAssetCheckableOut(asset as AssetWithStatus, checkedOutIdsSet, {
      remainingByAssetId: remainingToCheckOutByAsset ?? {},
    })
  ).length;

  // Grey out check-in when nothing in the selection is checked out. Tailor the
  // reason: "already checked in" reads better when that's the actual cause.
  const allSelectedAlreadyCheckedIn =
    selectedAssets.length > 0 &&
    selectedAssets.every((asset) =>
      isAssetPartiallyCheckedIn(
        asset as AssetWithStatus,
        partialCheckinDetails,
        booking.status
      )
    );
  const partialCheckinDisabled =
    selectedAssets.length === 0
      ? { reason: "Select one or more assets to check in." }
      : checkInEligibleCount === 0
      ? {
          reason: allSelectedAlreadyCheckedIn
            ? "All selected items are already checked in. Select items that are still checked out."
            : "None of the selected items are checked out, so there's nothing to check in.",
        }
      : false;

  // Grey out check-out when every selected asset is already checked out.
  const partialCheckoutDisabled =
    selectedAssets.length === 0
      ? { reason: "Select one or more assets to check out." }
      : checkOutEligibleCount === 0
      ? {
          reason:
            "All selected items are already checked out. Select items that are still booked.",
        }
      : false;

  // Mirror per-row Remove: can't remove items from a finished booking.
  const removeDisabled = isFinished
    ? { reason: "Can't remove items from a completed or archived booking." }
    : false;

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  function closeMenu() {
    setOpen(false);
  }

  const [partialCheckinDialogOpen, setPartialCheckinDialogOpen] =
    useState(false);
  const [partialCheckoutDialogOpen, setPartialCheckoutDialogOpen] =
    useState(false);

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}

      <BulkRemoveAssetAndKitDialog />
      <BulkPartialCheckinDialog
        open={partialCheckinDialogOpen}
        setOpen={setPartialCheckinDialogOpen}
      />
      <BulkPartialCheckoutDialog
        open={partialCheckoutDialogOpen}
        setOpen={setPartialCheckoutDialogOpen}
      />

      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="actions-dropdown hidden sm:flex"
          onClick={() => setOpen(!open)}
          asChild
          disabled={actionsButtonDisabled}
        >
          <Button type="button" variant="secondary">
            <span className="flex items-center gap-2">Actions</span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="asset-actions sm:hidden"
          onClick={() => setOpen(true)}
          disabled={actionsButtonDisabled}
          type="button"
        >
          <span className="flex items-center gap-2">Actions</span>
        </Button>

        <MobileDropdownStyles open={open} />

        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            {showPartialCheckout && (
              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                onSelect={(e) => {
                  e.preventDefault();
                }}
              >
                <Button
                  type="button"
                  variant="link"
                  className={tw(
                    "flex w-full items-center justify-start gap-2 whitespace-nowrap px-4 py-3 text-gray-700 hover:text-gray-700"
                  )}
                  onClick={() => {
                    setPartialCheckoutDialogOpen(true);
                    closeMenu();
                  }}
                  disabled={partialCheckoutDisabled}
                >
                  <PackageMinus className="mr-2 inline size-5" />
                  <span>Check out selected items</span>
                </Button>
              </DropdownMenuItem>
            )}
            {showPartialCheckin && (
              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                onSelect={(e) => {
                  e.preventDefault();
                }}
              >
                <Button
                  type="button"
                  variant="link"
                  className={tw(
                    "flex w-full items-center justify-start gap-2 whitespace-nowrap px-4 py-3 text-gray-700 hover:text-gray-700"
                  )}
                  onClick={() => {
                    setPartialCheckinDialogOpen(true);
                    closeMenu();
                  }}
                  disabled={partialCheckinDisabled}
                >
                  <PackageCheck className="mr-2 inline size-5" />
                  <span>Check in selected items</span>
                </Button>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="trash"
                label="Remove assets/kits"
                onClick={closeMenu}
                disabled={removeDisabled}
              />
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
