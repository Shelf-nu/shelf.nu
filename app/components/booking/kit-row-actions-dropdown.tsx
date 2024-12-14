import type { Kit } from "@prisma/client";
import { Form, useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import type { BookingWithCustodians } from "~/routes/_layout+/bookings";
import { tw } from "~/utils/tw";
import { TrashIcon, VerticalDotsIcon } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";
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

export default function KitRowActionsDropdown({
  kit,
  fullWidth,
}: {
  kit: Kit;
  fullWidth?: boolean;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={tw("asset-actions", fullWidth ? "w-full" : "")}
        aria-label="Actions Trigger"
      >
        <span className="flex size-6 items-center justify-center gap-2 text-center">
          <VerticalDotsIcon />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-1.5 text-right "
      >
        <RemoveKitFromBooking kit={kit} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RemoveKitFromBooking({ kit }: { kit: Kit }) {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isArchived, isCompleted } = useBookingStatusHelpers(booking);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="link"
          icon="trash"
          className={tw(
            "justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none  hover:bg-slate-100 hover:text-gray-700"
          )}
          title={
            isArchived || isCompleted
              ? "Cannot remove assets from completed bookings"
              : undefined
          }
          disabled={isArchived || isCompleted}
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
          <AlertDialogTitle>Remove "{kit.name}" from booking</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove this kit from the booking?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Form method="post">
              <input type="hidden" name="kitId" value={kit.id} />
              <Button name="intent" value="removeKit">
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
