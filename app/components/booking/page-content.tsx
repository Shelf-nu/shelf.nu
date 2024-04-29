import { useLoaderData } from "@remix-run/react";
import { useBookingStatus } from "~/hooks/use-booking-status";
import type { loader } from "~/routes/_layout+/bookings.$bookingId";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingForm } from "./form";

export function BookingPageContent() {
  const { booking, teamMembers } = useLoaderData<typeof loader>();

  // @TODO fix this
  const bookingStatus = useBookingStatus(booking);

  return (
    <div
      id="bookingFormWrapper"
      className="md:mt-5 lg:flex lg:items-start lg:gap-4"
    >
      <div>
        <BookingForm
          id={booking.id}
          name={booking.name}
          startDate={
            booking.from
              ? dateForDateTimeInputValue(new Date(booking.from))
              : undefined
          }
          endDate={
            booking.to
              ? dateForDateTimeInputValue(new Date(booking.to))
              : undefined
          }
          custodianUserId={
            booking.custodianUserId ||
            teamMembers.find(
              (member) => member.user?.id === booking.custodianUserId
            )?.id
          }
          bookingStatus={bookingStatus}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
