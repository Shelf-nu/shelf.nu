import type { BookingStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";
import BulkPartialCheckinDialog from "./bulk-partial-checkin-dialog";
import BulkRemoveAssetAndKitDialog from "./bulk-remove-asset-and-kit-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
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
  const { booking } = useLoaderData<{ booking: { status: string } }>();
  const bookingStatus = useBookingStatusHelpers(
    booking.status as BookingStatus
  );
  const actionsButtonDisabled = selectedItems.length === 0;

  // Show partial check-in option only for ONGOING/OVERDUE bookings
  const showPartialCheckin =
    bookingStatus?.isOngoing || bookingStatus?.isOverdue;

  // Check if any selected items are AVAILABLE (already checked in)
  // For kits, we allow partial check-in as long as some assets are still CHECKED_OUT
  const hasOnlyAvailableAssets = selectedItems.every((item: any) => {
    if (item.type === "kit") {
      // For kits, check if ALL assets are AVAILABLE
      return item.assets.every((asset: any) => asset.status === "AVAILABLE");
    }
    // For individual assets, check the asset status
    return item.status === "AVAILABLE";
  });

  const partialCheckinDisabled = hasOnlyAvailableAssets
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
      <BulkPartialCheckinDialog />

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
                <BulkUpdateDialogTrigger
                  type="partial-checkin"
                  label="Check in selected items"
                  onClick={closeMenu}
                  disabled={partialCheckinDisabled}
                />
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
