import { useState } from "react";
import { BookingStatus, type Booking } from "@prisma/client";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

type RevertToDraftProps = {
  booking: Pick<Booking, "name" | "status">;
};

export default function RevertToDraftDialog({ booking }: RevertToDraftProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
        className="hidden justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 md:block"
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
              <Button className="flex-1">Confirm</Button>
            </form>
          </div>
        </Dialog>
      </DialogPortal>

      {/* Only for mobile */}
      <Button
        variant="link"
        className="block justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700  md:hidden"
        width="full"
        onClick={handleOpenDialog}
        disabled={booking.status !== BookingStatus.RESERVED}
      >
        Revert to Draft
      </Button>
    </>
  );
}
