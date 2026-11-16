/**
 * The hidden field that carries the request version an approver is looking
 * at into every form that can approve a booking request: Approve, and any
 * check-out of a pending request (an approver's check-out approves it).
 *
 * The version comes from the booking page's loader, so this field works on
 * that page and on the pages nested under it (scan and fulfil check-outs). It
 * renders nothing where there is no version: the server then refuses an
 * approval, and the approver reloads the request to review it.
 *
 * @see {@link file://../../../modules/booking/request-version.server.ts}
 */
import { useRouteLoaderData } from "react-router";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";

/** The booking page's route id, whose loader reads the request version. */
const BOOKING_PAGE_ROUTE_ID = "routes/_layout+/bookings.$bookingId.overview";

/**
 * The request version the booking page loaded, or `null` when there is none
 * (not a pending request, a viewer who may not approve, or another page).
 *
 * @returns The version string, or `null`
 */
export function useReviewedRequestVersion(): string | null {
  const data = useRouteLoaderData<BookingPageLoaderData>(BOOKING_PAGE_ROUTE_ID);
  return data?.requestVersion ?? null;
}

/**
 * Renders the request version as a hidden `reviewedVersion` field, or nothing
 * when the page has none.
 */
export function ReviewedVersionField() {
  const requestVersion = useReviewedRequestVersion();
  if (!requestVersion) return null;
  return <input type="hidden" name="reviewedVersion" value={requestVersion} />;
}
