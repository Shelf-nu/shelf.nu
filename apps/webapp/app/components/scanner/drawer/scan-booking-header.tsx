/**
 * Booking summary strip for the booking scan drawers (check-out and check-in).
 *
 * One row: booking name, status badge, then the period. The drawer is sized to
 * the viewport and everything above its list comes out of the scanned rows the
 * operator is checking, so this stays a single line on a laptop screen. On a
 * narrow screen it wraps instead of truncating the dates.
 *
 * @see {@link file://./uses/partial-checkout-drawer.tsx}
 * @see {@link file://./uses/partial-checkin-drawer.tsx}
 */

import type { Booking } from "@prisma/client";
import { BookingStatusBadge } from "~/components/booking/booking-status-badge";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";

/**
 * The booking fields the header shows. Dates are `Date | string` because the
 * drawers pass `useLoaderData().booking`, whose dates arrive serialized;
 * `DateS` accepts both.
 */
export type ScanBookingHeaderBooking = Pick<
  Booking,
  "id" | "name" | "status" | "custodianUserId"
> & {
  from: Date | string;
  to: Date | string;
};

/**
 * Renders the booking name (linked), its status and its period on one row.
 *
 * @param props.booking - The booking being scanned against
 */
export function ScanBookingHeader({
  booking,
}: {
  booking: ScanBookingHeaderBooking;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-b-0 bg-gray-50 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          to={`/bookings/${booking.id}`}
          variant="link"
          className="truncate text-left font-medium text-gray-900 hover:text-gray-700"
        >
          {booking.name}
        </Button>
        <BookingStatusBadge
          status={booking.status}
          custodianUserId={booking.custodianUserId || undefined}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 text-gray-600">
        <span className="sr-only">From</span>
        <span className="font-medium text-gray-900">
          <DateS date={booking.from} includeTime />
        </span>
        <span aria-hidden="true">→</span>
        <span className="sr-only">to</span>
        <span className="font-medium text-gray-900">
          <DateS date={booking.to} includeTime />
        </span>
      </div>
    </div>
  );
}
