import type { Booking } from "@prisma/client";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
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
   * Optional className override for the trigger button. Defaults to `"grow"`
   * to match the original action-bar usage in `edit-booking-form`. Embedded
   * contexts (e.g. the fulfil-and-checkout drawer) can pass a narrower class
   * so the button doesn't stretch oddly when its sibling buttons aren't also
   * `grow`.
   */
  triggerClassName?: string;
};

export default function CheckoutDialog({
  disabled,
  booking,
  portalContainer,
  formId,
  triggerClassName = "grow",
}: CheckoutDialogProps) {
  const isEarlyCheckout = isBookingEarlyCheckout(booking.from);

  if (!isEarlyCheckout) {
    return (
      <Button
        disabled={disabled}
        className={triggerClassName}
        size="sm"
        type="submit"
        name="intent"
        value="checkOut"
      >
        Check Out
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          className={triggerClassName}
          size="sm"
          type="button"
        >
          Check Out
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

          <input type="hidden" name="intent" value="checkOut" form={formId} />
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
