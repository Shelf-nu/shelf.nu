import { useActionData } from "react-router";
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
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { RejectBookingSchema } from "./forms/forms-schema";
import { AlertIcon } from "../icons/library";

type RejectBookingDialogProps = {
  bookingName: string;
};

export function RejectBookingDialog({ bookingName }: RejectBookingDialogProps) {
  const disabled = useDisabled();
  const zo = useZorm("RejectBooking", RejectBookingSchema);
  const actionData = useActionData<DataOrErrorResponse>();

  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof RejectBookingSchema>(
    actionData?.error
  );

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
          width="full"
        >
          Reject
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <AlertIcon />
            </span>
          </div>
          <AlertDialogTitle>Reject {bookingName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to reject this booking? The custodian will be
            notified and the reserved assets will become available again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Form method="post" ref={zo.ref}>
          <input type="hidden" name="intent" value="reject" />
          <div className="mb-4">
            <label
              htmlFor="rejectionReason"
              className="mb-1 block text-left text-[14px] font-medium text-gray-700"
            >
              Rejection reason{" "}
              <span className="font-normal text-gray-500">(required)</span>
            </label>
            <textarea
              id="rejectionReason"
              name={zo.fields.rejectionReason()}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-primary-500 focus:ring-primary-500"
              placeholder="Let the custodian know why this booking was rejected..."
              disabled={disabled}
              aria-describedby="rejectionReason-description"
            />
            {(validationErrors?.rejectionReason?.message ||
              zo.errors.rejectionReason()?.message) && (
              <p className="text-sm text-error-500">
                {validationErrors?.rejectionReason?.message ||
                  zo.errors.rejectionReason()?.message}
              </p>
            )}
            <p
              id="rejectionReason-description"
              className="-mt-1 text-text-sm text-gray-500"
            >
              The custodian will receive an email with this rejection reason.
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
                Reject booking
              </Button>
            </div>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
