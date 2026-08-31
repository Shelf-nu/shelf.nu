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
