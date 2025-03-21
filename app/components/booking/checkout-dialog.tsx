import type { Booking } from "@prisma/client";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
import type { ButtonProps } from "../shared/button";
import { Button } from "../shared/button";
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
  "checkout-with-adjusted-date" = "checkout-with-adjusted-date",
  "checkout-without-adjusted-date" = "checkout-without-adjusted-date",
}

type CheckoutDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name"> & {
    from: string | Date;
  };
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
};

export default function CheckoutDialog({
  disabled,
  booking,
  portalContainer,
}: CheckoutDialogProps) {
  const isEarlyCheckout = isBookingEarlyCheckout(booking.from);

  if (!isEarlyCheckout) {
    return (
      <Button
        disabled={disabled}
        className="grow"
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
        <Button disabled={disabled} className="grow" size="sm" type="button">
          Check Out
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Early Check-Out Warning</AlertDialogTitle>
          <AlertDialogDescription>
            You are checking out the booking before the start date. If you
            proceed, the start date will be adjusted to now.
            <br />
            Do you want to adjust the start date or keep the original date?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value="checkOut" />
          <Button
            className="flex-1"
            type="submit"
            variant="secondary"
            name="checkoutIntent"
            value="checkout-with-adjusted-date"
          >
            Adjust Date
          </Button>

          <Button
            className="flex-1"
            type="submit"
            variant="secondary"
            name="checkoutIntent"
            value="checkout-without-adjusted-date"
          >
            Don't Adjust Date
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
