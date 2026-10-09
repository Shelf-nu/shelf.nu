/**
 * Delete Booking Dialog
 *
 * Permanent delete of one booking, from the booking page's actions menu. The
 * user types the booking's name before Delete is enabled (see
 * {@link TypeToConfirm}). The copy is shared with the companion's delete sheet
 * through `@shelf/labels`.
 *
 * @see {@link file://../../routes/_layout+/bookings.$bookingId.overview.tsx} - Action handler
 */
import { useId } from "react";
import type { Booking } from "@prisma/client";
import { DELETE_CONSEQUENCE_LABELS } from "@shelf/labels";
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
import {
  TypeToConfirm,
  useTypeToConfirm,
} from "~/components/shared/type-to-confirm";
import { useDisabled } from "~/hooks/use-disabled";
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
  const disabled = useDisabled();
  const confirm = useTypeToConfirm(booking.name);
  // The field sits outside the form that submits; this links the two.
  const formId = useId();

  return (
    <AlertDialog
      onOpenChange={(open) => {
        // Each open starts empty, so an earlier attempt never arms the button.
        if (!open) confirm.reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
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
            {DELETE_CONSEQUENCE_LABELS.BOOKING}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <TypeToConfirm
          form={formId}
          expected={booking.name}
          value={confirm.value}
          onChange={confirm.setValue}
          disabled={disabled}
        />
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form id={formId} method="delete">
              <Button
                className={tw(
                  "border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
                )}
                type="submit"
                data-test-id="confirmDeleteBookingButton"
                name="intent"
                value="delete"
                disabled={disabled || !confirm.isConfirmed}
              >
                {disabled ? "Deleting..." : "Delete"}
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
