import type { Booking } from "@prisma/client";
import { useNavigation } from "react-router";
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
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const DeleteBooking = ({
  booking,
}: {
  booking: {
    name: Booking["name"];
  };
}) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          data-test-id="deleteBookingButton"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
          width="full"
        >
          Delete
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>Delete {booking.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this Booking? This action cannot be
            undone. All assets associated with this booking will be released.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="delete">
              <Button
                className={tw(
                  "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                )}
                type="submit"
                data-test-id="confirmDeleteBookingButton"
                name="intent"
                value="delete"
                disabled={disabled}
              >
                Delete
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
