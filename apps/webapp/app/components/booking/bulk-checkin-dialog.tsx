/**
 * Bulk check-in from the bookings list.
 *
 * Opened from the list's Actions menu for a selection of ONGOING or OVERDUE
 * bookings. Posts `bulk-checkin` to the bookings bulk-actions route, which
 * refuses the whole batch up front when a booking is not in progress and then
 * checks the bookings in one by one. End dates are kept: there is no
 * early-date prompt in bulk, so the copy says so.
 *
 * Copies the shape of `bulk-cancel-dialog.tsx`; the shared
 * `BulkUpdateDialogContent` owns open state, the fetcher and clearing the
 * selection on success.
 *
 * @see {@link file://./../../routes/api+/bookings.bulk-actions.ts}
 * @see {@link file://./../../modules/booking/bulk-check-in-out.server.ts}
 */
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { BookingsIndexLoaderData } from "~/routes/_layout+/bookings._index";
import { isSelectingAllItems } from "~/utils/list";
import { BookingsListFields } from "./bookings-list-fields";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

/** What the bulk check-in form posts: the selected ids, or the select-all key. */
export const BulkCheckinBookingsSchema = z.object({
  bookingIds: z.array(z.string()).min(1),
});

/**
 * The "Check in (N) bookings" confirmation. Renders nothing visible until the
 * `checkin` bulk dialog is opened from the Actions menu.
 */
export default function BulkCheckinDialog() {
  const { totalItems } = useLoaderData<BookingsIndexLoaderData>();

  const bookingsSelected = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(bookingsSelected)
    ? totalItems
    : bookingsSelected.length;

  const zo = useZorm("BulkCheckinBookings", BulkCheckinBookingsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="checkin"
      arrayFieldId="bookingIds"
      actionUrl="/api/bookings/bulk-actions"
      title={`Check in (${totalSelected}) bookings`}
      description="This checks in every asset of the selected bookings and completes them. End dates are kept. Bookings are processed one by one: if one cannot be checked in, the ones before it stay checked in and the rest are left as they are."
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-checkin" name="intent" />
          <BookingsListFields />

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
            >
              {disabled ? "Checking in..." : "Check in"}
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
