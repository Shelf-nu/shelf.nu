import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { BookingsIndexLoaderData } from "~/routes/_layout+/bookings._index";
import { isSelectingAllItems } from "~/utils/list";
import { BulkDeleteConfirmation } from "../bulk-update-dialog/bulk-delete-confirmation";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";

export const BulkDeleteBookingSchema = z.object({
  bookingIds: z.array(z.string()).min(1),
  /** The typed count; checked by the server, see `assertBulkDeleteConfirmed`. */
  confirmation: z.string().optional(),
});

export default function BulkDeleteDialog() {
  const { totalItems } = useLoaderData<BookingsIndexLoaderData>();

  const zo = useZorm("BulkDeleteBookings", BulkDeleteBookingSchema);

  const selectedBookings = useAtomValue(selectedBulkItemsAtom);

  const totalSelected = isSelectingAllItems(selectedBookings)
    ? totalItems
    : selectedBookings.length;
  const noun = totalSelected === 1 ? "booking" : "bookings";

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="trash"
      arrayFieldId="bookingIds"
      actionUrl="/api/bookings/bulk-actions"
      title={`Delete ${totalSelected} ${noun}`}
      description={`This permanently deletes ${totalSelected} ${noun} with their notes, model reservations and check-in and check-out history. Assets on an ongoing or overdue booking become available. This cannot be undone.`}
    >
      {({
        fetcherError,
        fetcherErrorAdditionalData,
        disabled,
        handleCloseDialog,
      }) => (
        <>
          <input type="hidden" value="bulk-delete" name="intent" />
          <BulkDeleteConfirmation
            count={totalSelected}
            disabled={disabled}
            fetcherError={fetcherError}
            fetcherErrorAdditionalData={fetcherErrorAdditionalData}
            onCancel={handleCloseDialog}
          />
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
