import type { Asset } from "@prisma/client";
import { useLoaderData } from "react-router";
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
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useDisabled } from "~/hooks/use-disabled";
import type { BookingWithCustodians } from "~/modules/booking/types";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const RemoveAssetFromBooking = ({ asset }: { asset: Asset }) => {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isArchived, isCompleted } = useBookingStatusHelpers(booking.status);
  const disabled = useDisabled();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          data-test-id="deleteBookingButton"
          icon="trash"
          className={tw(
            "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-color-700 outline-none   hover:bg-color-50 hover:text-color-700"
          )}
          title={
            isArchived || isCompleted
              ? "Cannot remove assets from completed bookings"
              : undefined
          }
          width="full"
          disabled={disabled || isArchived || isCompleted}
        >
          Remove
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>
            Remove "{asset.title}" from booking
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this asset from the booking?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="assetId" value={asset.id} />
              <Button name="intent" value="removeAsset" disabled={disabled}>
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
