/**
 * Check-out dropdown
 *
 * Mirrors {@link file://./checkin-dropdown.tsx} for the check-out side of the
 * booking lifecycle. It collapses the two check-out entry points — full
 * "Check Out" and progressive "Scan to check out" — into a single dropdown so
 * the booking header stays clean and consistent with the check-in control.
 *
 * The quick option adapts to the booking status:
 * - **Check out** (full booking, intent `checkOut`) while the booking is
 *   RESERVED — checks out every asset and starts the booking.
 * - **Check out remaining** (intent `checkOutRemaining`) while ONGOING/OVERDUE —
 *   checks out the assets still in the Booked bucket in one go.
 *
 * The second option, **Scan to check out** (progressive scanner), is offered
 * whenever items remain in the Booked bucket.
 *
 * When only the quick option applies the component renders it as a single
 * button instead of a dropdown.
 *
 * @see {@link file://./checkout-dialog.tsx} - the "Check Out" trigger/flow
 * @see {@link file://./forms/edit-booking-form.tsx} - the call site
 */
import type { Booking } from "@prisma/client";
import { ChevronRightIcon, ScanLine } from "lucide-react";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";
import CheckoutDialog from "./checkout-dialog";
import type { ButtonProps } from "../shared/button";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";

type CheckoutDropdownProps = {
  /** Disables the trigger and the "Scan to check out" option */
  disabled?: ButtonProps["disabled"];
  /**
   * Disables the full "Check Out" option specifically. Carries its own
   * unmet-precondition reason (unavailable assets, already-booked, in custody),
   * which differs from the generic `disabled` used by the scan option.
   */
  checkOutDisabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name" | "from">;
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  /**
   * Whether the full-booking "Check out" option is available (booking RESERVED).
   * Submits intent `checkOut`.
   */
  canFullCheckOut: boolean;
  /**
   * Whether the "Check out remaining" option is available (booking ONGOING /
   * OVERDUE with items still in the Booked bucket). Submits intent
   * `checkOutRemaining`. Mutually exclusive with {@link canFullCheckOut}.
   */
  canCheckOutRemaining: boolean;
  /** Whether the progressive "Scan to check out" option is available */
  canScanCheckOut: boolean;
};

/**
 * Renders the check-out control for a booking.
 *
 * @param props - {@link CheckoutDropdownProps}
 * @returns A dropdown when both options apply, otherwise a single button, or
 *   `null` when neither option is available.
 */
export default function CheckoutDropdown({
  disabled,
  checkOutDisabled,
  booking,
  portalContainer,
  formId,
  canFullCheckOut,
  canCheckOutRemaining,
  canScanCheckOut,
}: CheckoutDropdownProps) {
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

  // The quick option adapts to status: a full "Check out" (intent `checkOut`)
  // while RESERVED, or "Check out remaining" (intent `checkOutRemaining`) while
  // ONGOING/OVERDUE. The two flags are mutually exclusive.
  const hasQuickCheckout = canFullCheckOut || canCheckOutRemaining;
  const quickCheckoutIntent = canCheckOutRemaining
    ? "checkOutRemaining"
    : "checkOut";
  const quickCheckoutLabel = canCheckOutRemaining
    ? "Check out remaining"
    : "Check out";

  // The full check-out (RESERVED) must validate the WHOLE booking up front, so
  // it carries the strict precondition reasons (in custody, already booked,
  // some asset already CHECKED_OUT elsewhere). "Check out remaining" only ever
  // acts on the still-Booked AVAILABLE assets — partialCheckoutBooking guards
  // those per-asset server-side — so, like the scan entry point, it uses only
  // the generic `disabled` and must NOT inherit `hasCheckedOutAssets` (which is
  // expected: this booking's own scanned-out assets are CHECKED_OUT).
  const quickCheckoutDisabled = canFullCheckOut ? checkOutDisabled : disabled;

  // Check-out is the primary action while RESERVED, but a secondary one while
  // ONGOING/OVERDUE (where check-in is the primary action beside it).
  const triggerVariant = canFullCheckOut ? "primary" : "secondary";

  /** Link-style row that navigates to the progressive scan-to-check-out page */
  const scanToCheckOutLink = (
    <Button
      variant="link"
      className={tw(
        "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
      )}
      width="full"
      onClick={closeMenu}
      disabled={disabled}
      to={`/bookings/${booking.id}/overview/checkout-assets`}
    >
      <span className="flex items-center gap-2">
        <ScanLine className="size-4" /> Scan to check out
      </span>
    </Button>
  );

  // Only the progressive scan applies (no quick option). Render a single
  // secondary button — no dropdown needed.
  if (canScanCheckOut && !hasQuickCheckout) {
    return (
      <Button
        variant="secondary"
        icon="scan"
        size="sm"
        className="grow whitespace-nowrap"
        to={`/bookings/${booking.id}/overview/checkout-assets`}
        disabled={disabled}
      >
        Scan to check out
      </Button>
    );
  }

  // Only the quick option applies (e.g. a RESERVED booking with no Booked items
  // left to scan). Render the dialog trigger on its own.
  if (hasQuickCheckout && !canScanCheckOut) {
    return (
      <CheckoutDialog
        portalContainer={portalContainer}
        formId={formId}
        booking={booking}
        disabled={quickCheckoutDisabled}
        intent={quickCheckoutIntent}
        label={quickCheckoutLabel}
        suppressEarlyCheckoutPrompt={canCheckOutRemaining}
      />
    );
  }

  return (
    <>
      {open && (
        <div className="fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden" />
      )}

      <DropdownMenu
        modal={false}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(openValue) => {
          if (defaultApplied && window.innerWidth <= 640) {
            setOpen(openValue);
          }
        }}
      >
        <DropdownMenuTrigger
          className="hidden sm:flex"
          onClick={() => {
            setOpen(!open);
          }}
          asChild
        >
          <Button
            type="button"
            variant={triggerVariant}
            disabled={disabled}
            className="grow"
            size="sm"
          >
            <span className="flex items-center gap-2">
              Check out <ChevronRightIcon className="chev size-4 rotate-90" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* Mobile button */}
        <Button
          type="button"
          variant={triggerVariant}
          className="flex-1 sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          size="sm"
        >
          <span className="flex items-center gap-2">
            Check out <ChevronRightIcon className="chev size-4" />
          </span>
        </Button>

        <MobileDropdownStyles open={open} />

        <DropdownMenuContent
          ref={dropdownRef}
          asChild
          className="order actions-dropdown w-screen rounded-b-none rounded-t bg-white p-0 text-right md:static md:w-56"
          align="end"
          portalContainer={portalContainer}
        >
          <div className="fixed bottom-0 left-0">
            <DropdownMenuItem className="py-1 lg:p-0">
              <CheckoutDialog
                booking={booking}
                disabled={quickCheckoutDisabled}
                portalContainer={portalContainer}
                formId={formId}
                intent={quickCheckoutIntent}
                label={quickCheckoutLabel}
                variant="dropdown"
                suppressEarlyCheckoutPrompt={canCheckOutRemaining}
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              {scanToCheckOutLink}
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
