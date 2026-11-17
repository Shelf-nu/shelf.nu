import { useState } from "react";
import { BookingStatus, type Booking } from "@prisma/client";
import { useActionData } from "react-router";
import { z } from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import Input from "../forms/input";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/**
 * The revert-to-draft form: an optional note for the custodian. The route's
 * `revert-to-draft` intent parses the post with this same schema, so the
 * dialog's server-error fallback names the field the server refused.
 */
export const RevertToDraftSchema = z.object({
  revertReason: z
    .string()
    .trim()
    .max(500, "Keep the reason under 500 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

type RevertToDraftProps = {
  booking: Pick<Booking, "name" | "status">;
};

export default function RevertToDraftDialog({ booking }: RevertToDraftProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const disabled = useDisabled();
  const actionData = useActionData<DataOrErrorResponse>();
  /**
   * The route's action data outlives this dialog, so a refusal from an earlier
   * opening would show on the next one. Remember what was current when the
   * dialog opened and show only a result that arrived after that.
   */
  const [actionDataAtOpen, setActionDataAtOpen] = useState(actionData);
  /** Server-side validation errors, the fallback when the client check is bypassed. */
  const validationErrors =
    actionData === actionDataAtOpen
      ? undefined
      : getValidationErrors<typeof RevertToDraftSchema>(actionData?.error);
  function handleOpenDialog() {
    setActionDataAtOpen(actionData);
    setIsDialogOpen(true);
  }

  function handleCloseDialog() {
    setIsDialogOpen(false);
  }

  return (
    <>
      <Button
        type="button"
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

            <form method="post" className="flex w-full flex-col gap-4">
              <input type="hidden" name="intent" value="revert-to-draft" />
              <Input
                label="Reason (optional)"
                name="revertReason"
                inputType="textarea"
                placeholder="Tell the custodian what to change before they submit it again"
                maxLength={500}
                rows={3}
                error={validationErrors?.revertReason?.message}
              />
              <div className="flex w-full items-center gap-4">
                <Button
                  variant="secondary"
                  className="flex-1"
                  type="button"
                  onClick={handleCloseDialog}
                >
                  Cancel
                </Button>
                <Button className="flex-1" type="submit" disabled={disabled}>
                  Confirm
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      </DialogPortal>

      {/* Only for mobile */}
      <Button
        type="button"
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
