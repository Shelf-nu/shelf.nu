import { useEffect, useRef, type MouseEventHandler } from "react";
import type { Booking } from "@prisma/client";
import { useActionData, useNavigation } from "@remix-run/react";
import { isBookingEarlyCheckout } from "~/modules/booking/helpers";
import type { BookingPageActionData } from "~/routes/_layout+/bookings.$bookingId.overview";
import { fireConfettiFromElement } from "~/utils/confetti";
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
  const navigation = useNavigation();
  const actionData = useActionData<BookingPageActionData>();
  const lastClickedButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasCheckoutSubmissionRef = useRef(false);

  const { state, formData } = navigation;

  useEffect(() => {
    if (state === "submitting") {
      const intent = formData?.get("intent");
      if (intent === "checkOut") {
        wasCheckoutSubmissionRef.current = true;
      }
      return;
    }

    if (state === "idle" && wasCheckoutSubmissionRef.current) {
      if (!actionData) {
        return;
      }

      wasCheckoutSubmissionRef.current = false;

      if (actionData?.error === null) {
        void fireConfettiFromElement(lastClickedButtonRef.current);
      }
    }
  }, [actionData, formData, state]);

  const handleCheckoutClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    lastClickedButtonRef.current = event.currentTarget;
  };

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
        ref={(node) => {
          if (node) {
            lastClickedButtonRef.current = node as HTMLButtonElement;
          }
        }}
        onClick={handleCheckoutClick}
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
            <Button disabled={disabled} variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value="checkOut" />
          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            variant="secondary"
            name="checkoutIntentChoice"
            value={CheckoutIntentEnum["without-adjusted-date"]}
            ref={(node) => {
              if (!lastClickedButtonRef.current && node) {
                lastClickedButtonRef.current = node as HTMLButtonElement;
              }
            }}
            onClick={handleCheckoutClick}
          >
            Don't Adjust Date
          </Button>

          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            name="checkoutIntentChoice"
            value={CheckoutIntentEnum["with-adjusted-date"]}
            ref={(node) => {
              if (!lastClickedButtonRef.current && node) {
                lastClickedButtonRef.current = node as HTMLButtonElement;
              }
            }}
            onClick={handleCheckoutClick}
          >
            Adjust Date
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
