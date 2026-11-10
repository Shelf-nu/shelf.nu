/**
 * Confirmation dialog for approving a booking request.
 *
 * Posts intent `approve-booking` to the booking route. Approval does not move
 * the booking out of RESERVED; it only clears the gate that keeps a pending
 * request from being checked out.
 *
 * @see {@link file://./../../../routes/_layout+/bookings.$bookingId.tsx}
 */
import { useReducer, type ReactNode } from "react";
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

type DialogState = {
  isDialogOpen: boolean;
  /** Set on the first submit, so a double click posts once. */
  isSubmitting: boolean;
};

type DialogAction =
  | { type: "open" }
  | { type: "submit" }
  | { type: "close"; isBusy: boolean };

const CLOSED: DialogState = { isDialogOpen: false, isSubmitting: false };

/**
 * Opening re-arms the dialog (a post still in flight keeps the button off
 * through `useDisabled`). Closing re-arms it only once nothing is in flight,
 * so closing mid-post does not allow a second post.
 */
function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "open":
      return { isDialogOpen: true, isSubmitting: false };
    case "submit":
      return { ...state, isSubmitting: true };
    case "close":
      return {
        isDialogOpen: false,
        isSubmitting: action.isBusy ? state.isSubmitting : false,
      };
  }
}

/**
 * Renders the approval trigger and its confirmation dialog.
 *
 * The built-in trigger is disabled unless the booking is RESERVED, since
 * nothing else can be approved. Callers that need a different affordance (a
 * dropdown row rather than a header button) pass `trigger` and own that gating
 * themselves.
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
  const [{ isDialogOpen, isSubmitting }, dispatch] = useReducer(
    dialogReducer,
    CLOSED
  );
  const isBusy = useDisabled();
  const disabled = isBusy || isSubmitting;

  function handleOpenDialog() {
    dispatch({ type: "open" });
  }

  function handleCloseDialog() {
    dispatch({ type: "close", isBusy });
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

            <form
              method="post"
              className="flex w-full items-center gap-4"
              onSubmit={() => dispatch({ type: "submit" })}
            >
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
