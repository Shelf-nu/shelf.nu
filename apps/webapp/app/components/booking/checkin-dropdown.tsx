/**
 * Check-in dropdown for the booking header: "Quick check-in" (a confirmation
 * dialog) and "Explicit check-in" (the scanner page).
 *
 * The Quick check-in dialog renders beside the menu, never inside a menu row:
 * the menu closes when a row is picked, and a dialog inside it would close
 * with it.
 *
 * @see {@link file://./checkin-dialog.tsx} the confirmation dialog
 * @see {@link file://./checkout-dropdown.tsx} the check-out side
 */
import { useRef, useState } from "react";
import type { Booking } from "@prisma/client";
import { ChevronRightIcon, ListChecks, Zap } from "lucide-react";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useDisabled } from "~/hooks/use-disabled";
import { firstDisplayedElement } from "~/utils/sheet-viewport";
import { tw } from "~/utils/tw";
import CheckinDialog from "./checkin-dialog";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";

type CheckinDropdownProps = {
  disabled?: boolean;
  booking: Pick<Booking, "id" | "name" | "from" | "to">;
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  requireExplicitCheckin?: boolean;
};

/**
 * The booking header's Check-in control: a dropdown with Quick and Explicit
 * check-in, or a single button to the scanner when explicit check-in is
 * required for the viewer's role.
 *
 * @param props - {@link CheckinDropdownProps}
 */
export default function CheckinDropdown({
  disabled,
  booking,
  portalContainer,
  formId,
  requireExplicitCheckin,
}: CheckinDropdownProps) {
  const {
    ref: dropdownRef,
    onOpenChange,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();
  /** The Quick check-in dialog, rendered outside the menu. */
  const [checkinDialogOpen, setCheckinDialogOpen] = useState(false);
  const isNavigating = useDisabled();
  /** Whether the Quick check-in row can act right now. */
  const quickCheckinBlocked = Boolean(disabled) || isNavigating;
  /** The desktop and mobile menu triggers: one of them is hidden by CSS. */
  const desktopTriggerRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLElement>(null);

  function closeMenu() {
    setOpen(false);
  }

  /**
   * The visible menu trigger, for focus to return to when the dialog closes:
   * the row that opened the dialog is gone with the menu.
   */
  function visibleMenuTrigger(): HTMLElement | null {
    return firstDisplayedElement(
      desktopTriggerRef.current,
      mobileTriggerRef.current
    );
  }

  // When explicit check-in is required, render a single button that navigates
  // directly to the explicit check-in page (no dropdown, no quick check-in)
  if (requireExplicitCheckin) {
    return (
      <Button
        disabled={disabled}
        className="grow"
        size="sm"
        to={`/bookings/${booking.id}/overview/checkin-assets`}
      >
        Check-in
      </Button>
    );
  }

  return (
    <>
      {open && (
        <div className="fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden" />
      )}

      <CheckinDialog
        booking={booking}
        disabled={disabled}
        portalContainer={portalContainer}
        formId={formId}
        label="Quick check-in"
        open={checkinDialogOpen}
        onOpenChange={setCheckinDialogOpen}
        returnFocusTo={visibleMenuTrigger}
      />

      <DropdownMenu
        modal={false}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
      >
        <DropdownMenuTrigger className="hidden md:flex" asChild>
          <Button
            ref={desktopTriggerRef}
            type="button"
            disabled={disabled}
            className="grow"
            size="sm"
          >
            <span className="flex items-center gap-2">
              Check-in <ChevronRightIcon className="chev size-4 rotate-90" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* Mobile button */}
        <Button
          ref={mobileTriggerRef}
          type="button"
          className="flex-1 md:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          size="sm"
        >
          <span className="flex items-center gap-2">
            Check-in <ChevronRightIcon className="chev size-4" />
          </span>
        </Button>

        <MobileDropdownStyles open={open} />

        <DropdownMenuContent
          data-mobile-sheet
          ref={dropdownRef}
          asChild
          className="order actions-dropdown w-screen rounded-b-none rounded-t bg-white p-0 text-right md:static md:w-56"
          align="end"
          portalContainer={portalContainer}
        >
          <div className="fixed bottom-0 left-0">
            {/* The row only opens the dialog; the dialog lives beside the
                menu. Focus sits on the row, so it carries aria-disabled. */}
            <DropdownMenuItem
              className="py-1 lg:p-0"
              aria-disabled={quickCheckinBlocked || undefined}
              onSelect={(event) => {
                event.preventDefault();
                if (quickCheckinBlocked) return;
                setCheckinDialogOpen(true);
                closeMenu();
              }}
            >
              <Button
                type="button"
                variant="link"
                width="full"
                className="w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                disabled={quickCheckinBlocked}
              >
                <span className="flex items-center gap-2">
                  <Zap className="size-4" /> Quick check-in
                </span>
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <Button
                variant="link"
                className={tw(
                  "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                )}
                width="full"
                onClick={closeMenu}
                disabled={disabled}
                to={`/bookings/${booking.id}/overview/checkin-assets`}
              >
                <span className="flex items-center gap-2">
                  <ListChecks className="size-4" /> Explicit check-in
                </span>
              </Button>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
