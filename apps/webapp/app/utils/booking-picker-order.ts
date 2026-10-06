/**
 * Ordering for the "add to an existing booking" pickers.
 *
 * Both bulk dialogs (assets and asset models) are fed by
 * `/api/bookings/get-all`, which orders by start date ascending because other
 * callers want a plain chronological list. A picker wants something else: the
 * booking an operator is about to add to, at the top. That is not expressible
 * as a single column sort, because it depends on a comparison against the
 * current time, so the pickers reorder the fetched rows through this module
 * rather than changing the shared endpoint.
 *
 * @see {@link file://./../components/assets/assets-index/add-assets-to-existing-booking-dialog.tsx}
 * @see {@link file://./../components/assets/assets-index/model-booking/add-models-to-existing-booking-dialog.tsx}
 */

/** The two date fields a picker row must carry to be orderable. */
export type PickerBookingDates = {
  /** Start of the booking window, as a `Date` or an ISO string. */
  from: string | Date;
  /** End of the booking window, as a `Date` or an ISO string. */
  to: string | Date;
};

/**
 * Orders bookings for a picker: live and upcoming work first, finished work
 * after it.
 *
 * Three rules, in order:
 *
 * 1. A booking whose window has not ended sorts above one that has. A finished
 *    booking is still a legal target, so it stays in the list, but it is never
 *    what the picker opens on.
 * 2. Within the not-ended group, `from` ascending. The soonest booking is the
 *    one about to need its items.
 * 3. Within the ended group, `to` **descending**. The most recently finished
 *    booking is the one an operator is most likely to be correcting or topping
 *    up; ascending here would open a workspace with nothing upcoming on its
 *    oldest booking ever, which is the least useful row in the list.
 *
 * "Ended" means the end of the window lies strictly in the past: a booking
 * whose `to` equals `now` counts as not ended and stays in the first group.
 *
 * `now` is a parameter so the ordering is a pure function of its inputs. A
 * timestamp captured once per render is what the call sites pass.
 *
 * @param bookings - Rows to order. Not mutated; a sorted copy is returned.
 * @param now - Epoch milliseconds to judge "ended" against.
 * @returns A new array in picker order.
 */
export function sortPickerBookings<T extends PickerBookingDates>(
  bookings: T[],
  now: number
): T[] {
  const hasEnded = (booking: T) => new Date(booking.to).getTime() < now;

  return [...bookings].sort((a, b) => {
    const aEnded = hasEnded(a);
    const bEnded = hasEnded(b);

    if (aEnded !== bEnded) {
      return aEnded ? 1 : -1;
    }

    if (aEnded) {
      return new Date(b.to).getTime() - new Date(a.to).getTime();
    }

    return new Date(a.from).getTime() - new Date(b.from).getTime();
  });
}
