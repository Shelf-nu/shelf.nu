import { BookingStatus } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useNavigation } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { isBookingArchivable } from "~/modules/booking/helpers";
import { isFormProcessing } from "~/utils/form";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { isExplicitScanRequired } from "~/utils/permissions/role-access";
import { tw } from "~/utils/tw";
import BulkArchiveDialog from "./bulk-archive-dialog";
import BulkCancelDialog from "./bulk-cancel-dialog";
import BulkCheckinDialog from "./bulk-checkin-dialog";
import BulkCheckoutDialog from "./bulk-checkout-dialog";
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
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";

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

  const everyBookingInDraft = selectedBookings.every(
    (booking) => booking.status === BookingStatus.DRAFT
  );

  /**
   * Archive is enabled only when every selected booking is archivable —
   * COMPLETE, or a RESERVED booking whose end date has passed. The server
   * re-checks via {@link isBookingArchivable}; this is the matching UI gate.
   */
  const allBookingsArchivable =
    selectedBookings.length > 0 &&
    selectedBookings.every((b) =>
      isBookingArchivable({ status: b.status, to: b.to })
    );

  const cancelIsDisabled = selectedBookings.some((b) =>
    [
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETE,
      BookingStatus.DRAFT,
    ].includes(b.status as any)
  );

  const roles = useOrganizationRoles();
  const roleAccess = useRoleAccess();
  const bookingSettings = useBookingSettings();

  /**
   * Bulk check-out takes a selection of RESERVED bookings only; bulk check-in
   * a selection of ONGOING or OVERDUE ones. Both are the list twins of the
   * booking page's one-click buttons, so they ask for the same grant and are
   * refused under the same explicit-mode switch. The server re-checks all of
   * it; this is the matching UI gate, with the reason the operator sees.
   */
  // "Select all N entries" adds a sentinel row with no status. The rows it
  // stands for are not in the browser, so the status rule is left to the
  // server, which refuses the whole batch by name.
  const selectedRows = selectedBookings.filter(
    (b) => b.id !== ALL_SELECTED_KEY
  );
  const everyBookingReserved =
    selectedBookings.length > 0 &&
    selectedRows.every((b) => b.status === BookingStatus.RESERVED);
  const everyBookingInProgress =
    selectedBookings.length > 0 &&
    selectedRows.every(
      (b) =>
        b.status === BookingStatus.ONGOING || b.status === BookingStatus.OVERDUE
    );
  const canCheckOutBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkout,
  });
  const canCheckInBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkin,
  });
  const explicitCheckoutRequired = isExplicitScanRequired({
    access: roleAccess,
    settings: bookingSettings,
    direction: "checkout",
  });
  const explicitCheckinRequired = isExplicitScanRequired({
    access: roleAccess,
    settings: bookingSettings,
    direction: "checkin",
  });

  const checkoutDisabledReason = !canCheckOutBooking
    ? "You don't have permission to check out bookings."
    : explicitCheckoutRequired
    ? "This workspace requires explicit check-out for your role. Open each booking and scan or select its assets."
    : !everyBookingReserved
    ? "Some of the selected bookings are not reserved. You can only check out reserved bookings."
    : null;
  const checkinDisabledReason = !canCheckInBooking
    ? "You don't have permission to check in bookings."
    : explicitCheckinRequired
    ? "This workspace requires explicit check-in for your role. Open each booking and scan or select its assets."
    : !everyBookingInProgress
    ? "Some of the selected bookings are not in progress. You can only check in ongoing or overdue bookings."
    : null;

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const disabled = selectedBookings.length === 0;

  const canArchiveBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.archive,
  });

  const archiveDisabled = !allBookingsArchivable || !canArchiveBooking;

  // Members held to drafts may bulk-delete only a selection of drafts; the
  // server refuses anything else. Loading is handled by the trigger's own
  // fallback, so this flag carries only the drafts-only reason.
  const deleteDisabled =
    roleAccess.policy.bookings.deleteOnlyDrafts && !everyBookingInDraft;

  const {
    ref: dropdownRef,
    onOpenChange,
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
      <BulkCheckoutDialog />
      <BulkCheckinDialog />

      <DropdownMenu
        modal={false}
        onOpenChange={onOpenChange}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="actions-dropdown hidden md:flex"
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
          className="asset-actions flex-1 md:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          type="button"
        >
          <span className="flex items-center gap-2">Actions</span>
        </Button>

        <MobileDropdownStyles open={open} />

        <DropdownMenuContent
          data-mobile-sheet
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
                type="checkout"
                label="Check out"
                onClick={closeMenu}
                disabled={
                  checkoutDisabledReason
                    ? { reason: checkoutDisabledReason }
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
                type="checkin"
                label="Check in"
                onClick={closeMenu}
                disabled={
                  checkinDisabledReason
                    ? { reason: checkinDisabledReason }
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
                          "Some selected bookings can't be archived. You can only archive completed bookings, or reserved bookings whose end date has passed.",
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
