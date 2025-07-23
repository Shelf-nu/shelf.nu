import { BookingStatus } from "@prisma/client";
import { useNavigation } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isFormProcessing } from "~/utils/form";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import BulkArchiveDialog from "./bulk-archive-dialog";
import BulkCancelDialog from "./bulk-cancel-dialog";
import BulkDeleteDialog from "./bulk-delete-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
import { ChevronRight } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export default function BulkActionsDropdown() {
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
    <div className="actions-dropdown flex flex-1 justify-end">
      <ConditionalDropdown />
    </div>
  );
}

function ConditionalDropdown() {
  const selectedBookings = useAtomValue(selectedBulkItemsAtom);

  const someBookingInDraft = selectedBookings.some(
    (booking) => booking.status === "DRAFT"
  );

  const allBookingAreCompleted = selectedBookings.every(
    (b) => b.status === "COMPLETE"
  );

  const cancelIsDisabled = selectedBookings.some((b) =>
    [
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETE,
      BookingStatus.DRAFT,
    ].includes(b.status as any)
  );

  const { isBase, roles } = useUserRoleHelper();

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const disabled = selectedBookings.length === 0;

  const canArchiveBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.archive,
  });

  const archiveDisabled = !allBookingAreCompleted || !canArchiveBooking;

  /** Base users dont have permissions to delete bookings unless they are draft */
  const deleteDisabled = (isBase && !someBookingInDraft) || isBase || isLoading;

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

      <BulkDeleteDialog />
      <BulkArchiveDialog />
      <BulkCancelDialog />

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
          disabled={disabled}
        >
          <Button type="button" variant="secondary">
            <span className="flex items-center gap-2">Actions</span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="asset-actions flex-1 sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
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
            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="cancel"
                label="Cancel"
                onClick={closeMenu}
                disabled={
                  cancelIsDisabled
                    ? {
                        reason:
                          "Some of the selected bookings are not reserved or in progress. You can only cancel bookings that are reserved or in progress.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>

            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="archive"
                label="Archive"
                disabled={
                  archiveDisabled
                    ? {
                        reason:
                          "Some of the selected bookings are not completed. You can only archive bookings that are completed.",
                      }
                    : isLoading
                }
                onClick={closeMenu}
              />
            </DropdownMenuItem>

            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="trash"
                label="Delete"
                onClick={closeMenu}
                disabled={
                  deleteDisabled
                    ? {
                        reason:
                          "Some of the selected bookings are not in draft or you have self user permissions. You can only delete draft bookings.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
