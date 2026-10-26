/**
 * Availability window for a booking's asset pickers.
 *
 * The "Add assets" picker can hide assets that are unavailable. Unavailable
 * means unavailable during THIS booking, so the window comes from the booking,
 * never from the URL: a link without `bookingFrom` / `bookingTo`, or with dates
 * the booking has since moved away from, still measures against the booking.
 * The booking's own items are exempt from the conflict check, so they stay
 * listed (and can be deselected) however the link was built.
 *
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx}
 */

/** The booking the window is pinned to; a draft may have no dates yet. */
type BookingWindow = {
  id: string;
  from: Date | string | null;
  to: Date | string | null;
};

/**
 * Returns the request a booking's asset picker reads its list from, with the
 * "hide unavailable" window pinned to the booking's own dates.
 *
 * A booking with no dates has no window to hide by, so the filter is dropped
 * and every asset is listed. A request that does not ask to hide unavailable
 * assets is returned as it is.
 *
 * @param request - The picker's incoming request; its URL carries the filters
 * @param booking - The booking the picker adds assets to
 * @returns The same request, or a GET request for the corrected URL that keeps
 *   the original headers (the per-page cookie is read from them)
 */
export function pinBookingAvailabilityWindow(
  request: Request,
  booking: BookingWindow
): Request {
  const url = new URL(request.url);
  if (url.searchParams.get("hideUnavailable") !== "true") return request;

  if (booking.from && booking.to) {
    url.searchParams.set("bookingFrom", new Date(booking.from).toISOString());
    url.searchParams.set("bookingTo", new Date(booking.to).toISOString());
    // Without this, the booking's own reserved or checked-out items read as
    // conflicting with the booking itself and drop out of the list.
    url.searchParams.set("unhideAssetsBookigIds", booking.id);
  } else {
    url.searchParams.delete("hideUnavailable");
    url.searchParams.delete("bookingFrom");
    url.searchParams.delete("bookingTo");
  }

  return new Request(url, { headers: request.headers, signal: request.signal });
}
