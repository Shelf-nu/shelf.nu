import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/bookings.$bookingId";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingForm } from "./form";

export function BookingPageContent() {
  const { booking, teamMembers, bookingFlags } = useLoaderData<typeof loader>();

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
          booking={{
            id: booking.id,
            status: booking.status,
            name: booking.name,
            description: booking.description,
            bookingFlags,
            startDate: booking.from
              ? dateForDateTimeInputValue(new Date(booking.from))
              : undefined,
            endDate: booking.to
              ? dateForDateTimeInputValue(new Date(booking.to))
              : undefined,
            custodianRef: custodianUser?.id,
          }}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
