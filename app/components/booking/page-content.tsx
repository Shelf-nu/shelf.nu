import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/bookings.$bookingId";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { EditBookingForm } from "./forms/edit-booking-form";

export function BookingPageContent() {
  const { booking, teamMembers, bookingFlags } = useLoaderData<typeof loader>();

  const custodian = teamMembers.find((member) =>
    booking.custodianUserId
      ? booking.custodianUserId === member?.userId
      : booking.custodianTeamMemberId === member.id
  );

  return (
    <div
      id="NewBookingFormWrapper"
      className="md:mt-5 lg:flex lg:items-start lg:gap-4"
    >
      <div>
        <EditBookingForm
          booking={{
            id: booking.id,
            status: booking.status,
            name: booking.name,
            description: booking.description,
            bookingFlags,
            startDate: dateForDateTimeInputValue(new Date(booking.from!)),
            endDate: dateForDateTimeInputValue(new Date(booking.to!)),
            custodianRef: custodian!.id, // We can safely assume that the custodian is always present because there cant be a booking without a custodian
          }}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
