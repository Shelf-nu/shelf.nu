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
  AlertDialogTitle,
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
    from: string | Date;
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

  /**
   * We have to make sure the current time is before the `from` date of the booking. See details: https://github.com/Shelf-nu/shelf.nu/issues/1839
   */
  const currentTimeIsBeforeFrom = new Date() < new Date(booking.from);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} className="grow" size="sm" type="button">
          Check-in
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent portalProps={{ container: portalContainer }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Early Check-in Warning</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription>
          {currentTimeIsBeforeFrom ? (
            <>
              You are checking in the booking more than 15 minutes before the
              end date, however you are not allowed to adjust the end date
              because the current time(
              <span className="font-bold text-gray-700">
                <DateS date={new Date()} includeTime />
              </span>
              ) is before the start date(
              <span className="font-bold text-gray-700">
                <DateS date={booking.from} includeTime />
              </span>
              ) of the booking.
            </>
          ) : (
            <>
              You are checking in the booking more than 15 minutes before the
              end date. If you proceed, the end date will be adjusted to now:{" "}
              <span className="font-bold text-gray-700">
                <DateS date={new Date()} includeTime />
              </span>
              .
              <br />
              <br />
              Do you want to adjust the end date or keep the original date?
            </>
          )}
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              disabled={disabled}
              variant="secondary"
              type="button"
              className={currentTimeIsBeforeFrom ? "flex-1" : ""}
            >
              Cancel
            </Button>
          </AlertDialogCancel>

          <input type="hidden" name="intent" value="checkIn" />

          <Button
            disabled={disabled}
            className="flex-1"
            type="submit"
            variant={currentTimeIsBeforeFrom ? "primary" : "secondary"}
            name="checkinIntentChoice"
            value={CheckinIntentEnum["without-adjusted-date"]}
          >
            {currentTimeIsBeforeFrom ? "Check In" : "Don't Adjust Date"}
          </Button>
          {!currentTimeIsBeforeFrom && (
            <Button
              disabled={disabled}
              className="flex-1"
              type="submit"
              name="checkinIntentChoice"
              value={CheckinIntentEnum["with-adjusted-date"]}
            >
              Adjust Date
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
