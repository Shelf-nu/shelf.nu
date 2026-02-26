import { useState } from "react";
import { BookingStatus, type Booking } from "@prisma/client";
import { useDisabled } from "~/hooks/use-disabled";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

type RevertToDraftProps = {
  booking: Pick<Booking, "name" | "status">;
};

export default function RevertToDraftDialog({ booking }: RevertToDraftProps) {
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
      <Button
        variant="link"
        className="hidden justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-color-700 outline-none hover:bg-color-50 hover:text-color-700 md:block"
        width="full"
        onClick={handleOpenDialog}
        disabled={booking.status !== BookingStatus.RESERVED}
      >
        Revert to Draft
      </Button>
      <DialogPortal>
        <Dialog
          className="md:max-w-sm"
          open={isDialogOpen}
          onClose={handleCloseDialog}
          title={
            <div>
              <h3>Reverting to draft state</h3>
            </div>
          }
        >
          <div className="px-6 pb-4">
            <p className="mb-4">
              Are you sure you want to revert{" "}
              <span className="font-bold">{booking.name}</span> booking back to
              draft?
            </p>

            <form method="post" className="flex w-full items-center gap-4">
              <input type="hidden" name="intent" value="revert-to-draft" />
              <Button
                variant="secondary"
                className="flex-1"
                type="button"
                onClick={handleCloseDialog}
              >
                Cancel
              </Button>
              <Button className="flex-1" disabled={disabled}>
                Confirm
              </Button>
            </form>
          </div>
        </Dialog>
      </DialogPortal>

      {/* Only for mobile */}
      <Button
        variant="link"
        className="block justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-color-700 outline-none hover:bg-color-50 hover:text-color-700  md:hidden"
        width="full"
        onClick={handleOpenDialog}
        disabled={booking.status !== BookingStatus.RESERVED}
      >
        Revert to Draft
      </Button>
    </>
  );
}
