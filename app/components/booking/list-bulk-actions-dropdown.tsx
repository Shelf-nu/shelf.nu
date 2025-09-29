import { useState } from "react";
import type { BookingStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { ChevronRight, PackageCheck } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import { isAssetPartiallyCheckedIn } from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import BulkPartialCheckinDialog from "./bulk-partial-checkin-dialog";
import BulkRemoveAssetAndKitDialog from "./bulk-remove-asset-and-kit-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
import type { ListItemData } from "../list/list-item";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

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
  const { booking, partialCheckinDetails = {} } =
    useLoaderData<BookingPageLoaderData>();
  const bookingStatus = useBookingStatusHelpers(
    booking.status as BookingStatus
  );
  const actionsButtonDisabled = selectedItems.length === 0;

  // Show partial check-in option only for ONGOING/OVERDUE bookings
  const showPartialCheckin =
    bookingStatus?.isOngoing || bookingStatus?.isOverdue;

  // Check if any selected items are already checked in using context-aware status
  // Filter out kit entries (which have undefined title) since bulk selection includes both kit AND its individual assets
  // We only need to check the individual assets for validation
  const assetsToCheck = selectedItems.filter(
    (item) => item.title !== undefined
  );

  const hasOnlyAlreadyCheckedInItems = assetsToCheck.every((item) => {
    // Type assertion since ListItemData includes asset properties via [x: string]: any
    // and we know these are asset items with status property
    const asset = item as ListItemData & { status: string };
    // For individual assets, check if already partially checked in
    return isAssetPartiallyCheckedIn(
      asset,
      partialCheckinDetails,
      booking.status
    );
  });

  const partialCheckinDisabled = hasOnlyAlreadyCheckedInItems
    ? {
        reason:
          "All selected assets are already checked in. Please select assets that are still checked out.",
      }
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

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
                }
              }`,
            }} // is a hack to fix the dropdown menu not being in the right place on mobile
            // can not target [data-radix-popper-content-wrapper] for this file only with css
            // so we have to use dangerouslySetInnerHTML
            // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
          ></style>
        )}

        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            {showPartialCheckin && (
              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                onSelect={(e) => {
                  e.preventDefault();
                }}
              >
                <Button
                  variant="link"
                  className={tw(
                    "flex w-full items-center  justify-start gap-2 px-4 py-3 text-gray-700 hover:text-gray-700"
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
              />
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
