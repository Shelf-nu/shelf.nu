import { useSubmit } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { AlertIcon } from "../icons/library";

type CancelBookingDialogProps = {
  bookingName: string;
};

export function CancelBookingDialog({ bookingName }: CancelBookingDialogProps) {
  const submit = useSubmit();
  const disabled = useDisabled();

  function handleConfirm() {
    const formData = new FormData();
    formData.append("intent", "cancel");
    submit(formData, { method: "post" });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
          width="full"
          as="span"
        >
          Cancel
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <AlertIcon />
            </span>
          </div>
          <AlertDialogTitle>Cancel {bookingName}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel this booking? This action cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Go back
              </Button>
            </AlertDialogCancel>

            <AlertDialogAction asChild>
              <Button
                type="button"
                className={tw(
                  "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                )}
                onClick={handleConfirm}
                disabled={disabled}
              >
                Cancel booking
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
