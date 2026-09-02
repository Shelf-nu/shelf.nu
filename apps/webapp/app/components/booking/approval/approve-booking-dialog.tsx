/**
 * Confirmation dialog for approving a booking request.
 *
 * Posts intent `approve-booking` to the booking route. Approval does not move
 * the booking out of RESERVED; it only clears the gate that keeps a pending
 * request from being checked out.
 *
 * @see {@link file://./../../../routes/_layout+/bookings.$bookingId.tsx}
 */
import { useState, type ReactNode } from "react";
import { BookingStatus, type Booking } from "@prisma/client";
import { useDisabled } from "~/hooks/use-disabled";
import { Dialog, DialogPortal } from "../../layout/dialog";
import { Button } from "../../shared/button";

type ApproveBookingDialogProps = {
  booking: Pick<Booking, "name" | "status">;
  /** Render prop for the trigger so callers control its look (header button
   *  vs dropdown row). */
  trigger?: (openDialog: () => void) => ReactNode;
};

/**
 * Renders the approval trigger and its confirmation dialog.
 *
 * The built-in trigger only renders for a RESERVED booking, since nothing else
 * can be approved. Callers that need a different affordance (a dropdown row
 * rather than a header button) pass `trigger` and own that gating themselves.
 *
 * @param props.booking - The booking being approved; its name is shown for
 *   confirmation and its status gates the default trigger.
 * @param props.trigger - Optional render prop receiving a function that opens
 *   the dialog.
 * @returns The trigger and dialog elements.
 */
export default function ApproveBookingDialog({
  booking,
  trigger,
}: ApproveBookingDialogProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const disabled = useDisabled();

  function handleOpenDialog() {
    setIsDialogOpen(true);
  }

  function handleCloseDialog() {
    setIsDialogOpen(false);
  }

  return (
    <>
      {trigger ? (
        trigger(handleOpenDialog)
      ) : (
        <Button
          type="button"
          onClick={handleOpenDialog}
          disabled={booking.status !== BookingStatus.RESERVED}
          size="sm"
          className="grow"
        >
          Approve
        </Button>
      )}
      <DialogPortal>
        <Dialog
          className="md:max-w-sm"
          open={isDialogOpen}
          onClose={handleCloseDialog}
          title={
            <div>
              <h3>Approve booking request</h3>
            </div>
          }
        >
          <div className="px-6 pb-4">
            <p className="mb-4">
              Approve <span className="font-bold">{booking.name}</span>? The
              custodian will be notified by email and the booking can then be
              checked out.
            </p>

            <form method="post" className="flex w-full items-center gap-4">
              <input type="hidden" name="intent" value="approve-booking" />
              <Button
                variant="secondary"
                className="flex-1"
                type="button"
                onClick={handleCloseDialog}
              >
                Cancel
              </Button>
              <Button className="flex-1" type="submit" disabled={disabled}>
                Approve
              </Button>
            </form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
