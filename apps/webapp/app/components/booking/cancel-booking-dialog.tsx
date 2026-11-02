/**
 * Cancel, as an action that works from any page: a confirmation dialog whose
 * form posts `intent=cancel` and the optional reason to the booking's own
 * overview action through a fetcher keyed on the booking. The server sends the
 * success toast; the dialog closes when the response is accepted and shows a
 * refusal (including a `cancellationReason` validation error) inline.
 *
 * @see {@link file://./booking-action-trigger.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} the action
 */
import { useEffect, useState } from "react";
import { XCircleIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";
import { CancelBookingSchema } from "./forms/forms-schema";
import { AlertIcon } from "../icons/library";

/** Props for {@link CancelBookingDialog}. */
type CancelBookingDialogProps = {
  /** The booking to cancel; `name` titles the dialog. */
  booking: { id: string; name: string };
  /** Defaults to `"menu-item"`. */
  trigger?: BookingActionTriggerVariant;
};

/**
 * Renders the cancel trigger and its confirmation dialog.
 *
 * @param props.booking - The booking to cancel
 * @param props.trigger - Menu row or icon button
 */
export function CancelBookingDialog({
  booking,
  trigger = "menu-item",
}: CancelBookingDialogProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `cancel-booking-${booking.id}`,
  });
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const disabled = useDisabled(fetcher);
  const zo = useZorm("CancelBooking", CancelBookingSchema);

  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof CancelBookingSchema>(
    open ? fetcher.data?.error : undefined
  );

  useEffect(() => {
    if (outcome.status === "accepted") setOpen(false);
  }, [outcome.status]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <BookingActionTrigger
          variant={trigger}
          label="Cancel"
          icon={<XCircleIcon className="size-4" />}
        />
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <AlertIcon />
            </span>
          </div>
          <AlertDialogTitle>Cancel {booking.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel this booking? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <fetcher.Form
          method="post"
          action={`/bookings/${booking.id}/overview`}
          ref={zo.ref}
        >
          <input type="hidden" name="intent" value="cancel" />
          <div className="mb-4">
            <label
              htmlFor="cancellationReason"
              className="mb-1 block text-left text-[14px] font-medium text-gray-700"
            >
              Cancellation reason{" "}
              <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <textarea
              id="cancellationReason"
              name={zo.fields.cancellationReason()}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
              placeholder="Let the custodian know why this booking was cancelled..."
              disabled={disabled}
              aria-describedby="cancellationReason-description"
            />
            {(validationErrors?.cancellationReason?.message ||
              zo.errors.cancellationReason()?.message) && (
              <p className="text-sm text-error-500">
                {validationErrors?.cancellationReason?.message ||
                  zo.errors.cancellationReason()?.message}
              </p>
            )}
            {/* A refusal that is not a field error, e.g. a status or permission refusal. */}
            {outcome.status === "rejected" &&
              !validationErrors?.cancellationReason && (
                <p className="text-sm text-error-500" role="alert">
                  {outcome.message}
                </p>
              )}
            <p
              id="cancellationReason-description"
              className="-mt-1 text-text-sm text-gray-500"
            >
              If the custodian has an associated user account with an email
              address, they will be notified of the cancellation reason.
            </p>
          </div>
          <AlertDialogFooter>
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button type="button" variant="secondary" disabled={disabled}>
                  Go back
                </Button>
              </AlertDialogCancel>
              <Button
                type="submit"
                className={tw(
                  "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                )}
                disabled={disabled}
              >
                Cancel booking
              </Button>
            </div>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
