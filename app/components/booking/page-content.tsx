import { useLoaderData } from "@remix-run/react";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import type { loader } from "~/routes/_layout+/bookings.$bookingId";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingForm } from "./form";

export function BookingPageContent() {
  const { booking, teamMembers, bookingFlags } = useLoaderData<typeof loader>();

  const bookingStatus = useBookingStatusHelpers(booking);

  const custodianUser = teamMembers.find((member) =>
    booking.custodianUserId
      ? booking.custodianUserId === member?.userId
      : booking.custodianTeamMemberId === member.id
  );

  return (
    <div
      id="bookingFormWrapper"
      className="md:mt-5 lg:flex lg:items-start lg:gap-4"
    >
      <div>
        <BookingForm
          id={booking.id}
          status={booking.status}
          name={booking.name}
          description={booking.description}
          bookingFlags={bookingFlags}
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
          custodianRef={custodianUser?.id}
          bookingStatus={bookingStatus}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
