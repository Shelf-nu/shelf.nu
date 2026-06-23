import type { Booking } from "@prisma/client";
import { Zap } from "lucide-react";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
import { tw } from "~/utils/tw";
import type { ButtonProps } from "../shared/button";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export enum CheckoutIntentEnum {
  "with-adjusted-date" = "with-adjusted-date",
  "without-adjusted-date" = "without-adjusted-date",
}

type CheckoutDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name" | "from">;
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
  /** Form ID for explicit form association when buttons render in a portal */
  formId?: string;
  /**
   * Optional className override for the trigger button. Defaults to the
   * variant-aware composition below (`"grow"` for the default variant,
   * full-width link styling for `"dropdown"`). Embedded contexts (e.g. the
   * fulfil-and-checkout drawer) can pass a narrower class so the button
   * doesn't stretch oddly when its sibling buttons aren't also `grow`.
   */
  triggerClassName?: string;
  /**
   * The form `intent` submitted with the checkout. Defaults to the full-booking
   * `"checkOut"` flow. The bulk partial-checkout dialog passes
   * `"partial-checkout"` so that an early checkout of the SELECTED assets routes
   * through `checkoutAssets` / `partialCheckoutBooking` (which records the batch
   * and applies the adjusted-date choice) instead of the whole-booking
   * `checkoutBooking`. The scanner checkout-assets route ignores intent (always
   * partial), so it can leave the default.
   */
  intent?: string;
  /** Custom label for the trigger button */
  label?: string;
  /**
   * Rendering context. `"dropdown"` styles the trigger as a left-aligned link
   * row so it sits inside a `DropdownMenuItem` like the check-in flow.
   */
  variant?: "default" | "dropdown";
  /**
   * Skip the early-checkout "adjust start date" prompt and submit directly.
   * Pass `true` when the booking has already started (ONGOING/OVERDUE) — e.g.
   * "Check out remaining" — because adjusting the start date only makes sense
   * for the first checkout that transitions RESERVED → ONGOING.
   * `partialCheckoutBooking` ignores the date choice unless the booking is
   * RESERVED, so prompting here would be a confusing no-op.
   */
  suppressEarlyCheckoutPrompt?: boolean;
  /** Render the trigger button full-width to match a sibling full-width button. */
  fullWidth?: boolean;
};

export default function CheckoutDialog({
  disabled,
  booking,
  portalContainer,
  formId,
  triggerClassName,
  intent = "checkOut",
  label = "Check Out",
  variant = "default",
  suppressEarlyCheckoutPrompt = false,
  fullWidth = false,
}: CheckoutDialogProps) {
  const isEarlyCheckout =
    !suppressEarlyCheckoutPrompt && isBookingEarlyCheckout(booking.from);

  /** Shared trigger styling so the dropdown row matches the check-in dropdown */
  const isDropdown = variant === "dropdown";
  /**
   * Default trigger styling computed from `variant`. Callers can override the
   * entire class via the `triggerClassName` prop (e.g. the fulfil-and-checkout
   * drawer narrows the button so it doesn't stretch oddly next to siblings).
   */
  const computedTriggerClassName = tw(
    "whitespace-nowrap",
    isDropdown
      ? "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
      : "grow"
  );
  const resolvedTriggerClassName = triggerClassName ?? computedTriggerClassName;
  /** Dropdown rows pair the label with an icon; the default trigger is text-only */
  const triggerContent = isDropdown ? (
    <span className="flex items-center gap-2">
      <Zap className="size-4" /> {label}
    </span>
  ) : (
    label
  );

  if (!isEarlyCheckout) {
    return (
      <Button
        disabled={disabled}
        className={resolvedTriggerClassName}
        size={isDropdown ? undefined : "sm"}
        type="submit"
        name="intent"
        value={intent}
        form={formId}
        variant={isDropdown ? "link" : "primary"}
        width={isDropdown || fullWidth ? "full" : undefined}
      >
        {triggerContent}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          className={resolvedTriggerClassName}
          size={isDropdown ? undefined : "sm"}
          type="button"
          variant={isDropdown ? "link" : "primary"}
          width={isDropdown || fullWidth ? "full" : undefined}
        >
          {triggerContent}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Early Check-Out Warning</AlertDialogTitle>
          <AlertDialogDescription>
            You are checking out the booking more than 15 minutes before the
            start date. If you proceed, the start date will be adjusted to now:{" "}
            <span className="font-bold text-gray-700">
              <DateS date={new Date()} includeTime />
            </span>
            .
            <br />
            <br />
            Do you want to adjust the start date or keep the original date?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" disabled={disabled} variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value={intent} form={formId} />
          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            variant="secondary"
            name="checkoutIntentChoice"
            value={CheckoutIntentEnum["without-adjusted-date"]}
            form={formId}
          >
            Don't Adjust Date
          </Button>

          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            name="checkoutIntentChoice"
            value={CheckoutIntentEnum["with-adjusted-date"]}
            form={formId}
          >
            Adjust Date
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
