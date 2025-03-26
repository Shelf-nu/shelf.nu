import type { Booking } from "@prisma/client";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import { Button, type ButtonProps } from "../shared/button";
import { DateS } from "../shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTrigger,
} from "../shared/modal";

export enum CheckinIntentEnum {
  "with-adjusted-date" = "with-adjusted-date",
  "without-adjusted-date" = "without-adjusted-date",
}

type CheckinDialogProps = {
  disabled?: ButtonProps["disabled"];
  booking: Pick<Booking, "id" | "name"> & {
    to: string | Date;
  };
  /** A container to render the AlertContent inside */
  portalContainer?: HTMLElement;
};

export default function CheckinDialog({
  disabled,
  booking,
  portalContainer,
}: CheckinDialogProps) {
  const isEarlyCheckin = isBookingEarlyCheckin(booking.to);

  if (!isEarlyCheckin) {
    return (
      <Button
        disabled={disabled}
        type="submit"
        name="intent"
        value="checkIn"
        className="grow"
        size="sm"
      >
        Check-in
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} className="grow" size="sm" type="button">
          Check-in
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <h3>Early Check-in Warning</h3>
        </AlertDialogHeader>
        <AlertDialogDescription>
          You are checking in the booking before the end date. If you proceed,
          the end date will be adjusted to now:{" "}
          <span className="font-bold text-gray-700">
            <DateS date={new Date()} includeTime />
          </span>
          .
          <br />
          <br />
          Do you want to adjust the end date or keep the original date?
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button disabled={disabled} variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value="checkIn" />

          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            variant="secondary"
            name="checkinIntentChoice"
            value={CheckinIntentEnum["without-adjusted-date"]}
          >
            Don't Adjust Date
          </Button>

          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            name="checkinIntentChoice"
            value={CheckinIntentEnum["with-adjusted-date"]}
          >
            Adjust Date
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
