/**
 * Duplicate, as an action that works from any page: a link to the booking's
 * duplicate route under its own overview path.
 *
 * Forwards its ref and spreads extra props so `DropdownMenuItem asChild` can
 * drive it.
 *
 * @see {@link file://./booking-action-trigger.tsx}
 */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { CopyIcon } from "lucide-react";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";

/** Props for {@link DuplicateBookingAction}. */
type DuplicateBookingActionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "disabled"
> & {
  booking: { id: string };
  /** Defaults to `"menu-item"`. */
  trigger?: BookingActionTriggerVariant;
};

/**
 * Links to the duplicate flow for the booking.
 *
 * @param props.booking - The booking to duplicate
 * @param props.trigger - Menu row or icon button
 */
export const DuplicateBookingAction = forwardRef<
  HTMLButtonElement,
  DuplicateBookingActionProps
>(function DuplicateBookingAction(
  { booking, trigger = "menu-item", ...rest },
  ref
) {
  return (
    <BookingActionTrigger
      {...rest}
      ref={ref}
      variant={trigger}
      label={trigger === "menu-item" ? "Duplicate booking" : "Duplicate"}
      icon={<CopyIcon className="size-4" />}
      to={`/bookings/${booking.id}/overview/duplicate`}
    />
  );
});
