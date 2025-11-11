import { useLoaderData } from "react-router";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { BookingsIndexLoaderData } from "~/routes/_layout+/bookings._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkArchiveBookingsSchema = z.object({
  bookingIds: z.array(z.string()).min(1),
});

export default function BulkArchiveDialog() {
  const { totalItems } = useLoaderData<BookingsIndexLoaderData>();

  const bookingsSelected = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(bookingsSelected)
    ? totalItems
    : bookingsSelected.length;

  const zo = useZorm("BulkArchiveBookings", BulkArchiveBookingsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="archive"
      arrayFieldId="bookingIds"
      actionUrl="/api/bookings/bulk-actions"
      title={`Archive (${totalSelected}) bookings`}
      description={`Are you sure you want to archive all (${totalSelected}) bookings?`}
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-archive" name="intent" />

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              disabled={disabled}
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
            >
              Confirm
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
