import type { Asset } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
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
import type { BookingWithCustodians } from "~/routes/_layout+/bookings";
import { tw } from "~/utils/tw";
import { Form } from "../custom-form";
import { TrashIcon } from "../icons/library";

export const RemoveAssetFromBooking = ({ asset }: { asset: Asset }) => {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isArchived, isCompleted } = useBookingStatusHelpers(booking);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          data-test-id="deleteBookingButton"
          icon="trash"
          className={tw(
            "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700",
            isArchived || isCompleted ? "pointer-events-none opacity-50" : ""
          )}
          title={
            isArchived || isCompleted
              ? "Cannot remove assets from completed bookings"
              : undefined
          }
          width="full"
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
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="assetId" value={asset.id} />
              <Button name="intent" value="removeAsset">
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
