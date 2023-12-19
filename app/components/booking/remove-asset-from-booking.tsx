import type { Asset } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
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
import { useBookingStatus } from "~/hooks/use-booking-status";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings._index";
import { TrashIcon } from "../icons";
import { ControlledActionButton } from "../subscription/premium-feature-button";

export const RemoveAssetFromBooking = ({ asset }: { asset: Asset }) => {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();

  const { isArchived, isCompleted } = useBookingStatus(booking);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <ControlledActionButton
          canUseFeature={!isArchived && !isCompleted}
          buttonContent={{
            title: "Remove",
            message:
              "You cannot remove assets from bookings that are completed or archived",
          }}
          buttonProps={{
            variant: "link",
            "data-test-id": "deleteBookingButton",
            icon: "trash",
            className:
              "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700",
            width: "full",
          }}
          skipCta={true}
        />
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
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

              <Button>Remove</Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
