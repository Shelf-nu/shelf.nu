/**
 * Bulk check-out from the bookings list.
 *
 * Opened from the list's Actions menu for a selection of RESERVED bookings.
 * Posts `bulk-checkout` to the bookings bulk-actions route, which refuses the
 * whole batch up front (wrong status, unassigned model units, a from-location
 * question) and then checks the bookings out one by one. Start dates are
 * kept: there is no early-date prompt in bulk, so the copy says so.
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

/** What the bulk check-out form posts: the selected ids, or the select-all key. */
export const BulkCheckoutBookingsSchema = z.object({
  bookingIds: z.array(z.string()).min(1),
});

/**
 * The "Check out (N) bookings" confirmation. Renders nothing visible until the
 * `checkout` bulk dialog is opened from the Actions menu.
 */
export default function BulkCheckoutDialog() {
  const { totalItems } = useLoaderData<BookingsIndexLoaderData>();

  const bookingsSelected = useAtomValue(selectedBulkItemsAtom);
  const totalSelected = isSelectingAllItems(bookingsSelected)
    ? totalItems
    : bookingsSelected.length;

  const zo = useZorm("BulkCheckoutBookings", BulkCheckoutBookingsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="checkout"
      arrayFieldId="bookingIds"
      actionUrl="/api/bookings/bulk-actions"
      title={`Check out (${totalSelected}) bookings`}
      description="This checks out every asset of the selected bookings and starts them. Start dates are kept. Bookings are processed one by one: if one cannot be checked out, the ones before it stay checked out and the rest are left as they are."
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <>
          <input type="hidden" value="bulk-checkout" name="intent" />
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
              {disabled ? "Checking out..." : "Check out"}
            </Button>
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
