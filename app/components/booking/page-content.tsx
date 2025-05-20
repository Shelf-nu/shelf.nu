import { useLoaderData } from "@remix-run/react";
import { formatBookingDuration } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import { useHints } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingStatistics } from "./booking-statistics";
import { EditBookingForm } from "./forms/edit-booking-form";

export function BookingPageContent() {
  const {
    booking,
    teamMembers,
    bookingFlags,
    totalItems: totalAssets,
    totalKits,
    totalValue,
    currentOrganization,
    allCategories,
  } = useLoaderData<BookingPageLoaderData>();
  const hints = useHints();
  const custodian = teamMembers.find((member) =>
    booking.custodianUserId
      ? booking.custodianUserId === member?.userId
      : booking.custodianTeamMemberId === member.id
  );
  return (
    <div
      id="NewBookingFormWrapper"
      // className="md:mt-5 lg:flex lg:items-start lg:gap-4"
      className="md:mt-5"
    >
      <div className="flex gap-3">
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
        <BookingStatistics
          duration={formatBookingDuration(booking.from!, booking.to!)}
          totalAssets={totalAssets}
          totalKits={totalKits}
          totalValue={formatCurrency({
            value: totalValue,
            locale: hints.locale,
            currency: currentOrganization.currency,
          })}
          allCategories={allCategories}
        />
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
