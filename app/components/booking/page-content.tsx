import { useLoaderData } from "@remix-run/react";
import { formatBookingDuration } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import { useHints } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingStatistics } from "./booking-statistics";
import { EditBookingForm } from "./forms/edit-booking-form";
import { Card } from "../shared/card";

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
    assetsCount,
  } = useLoaderData<BookingPageLoaderData>();
  const hints = useHints();
  const custodian = teamMembers.find((member) =>
    booking.custodianUserId
      ? booking.custodianUserId === member?.userId
      : booking.custodianTeamMemberId === member.id
  );
  return (
    <div className="md:mt-5">
      <div className="mb-8 flex h-full flex-col items-stretch gap-3 lg:mb-4 lg:flex-row">
        <Card className="-mx-4 my-0 lg:mx-0 lg:w-2/3">
          <EditBookingForm
            booking={{
              id: booking.id,
              status: booking.status,
              name: booking.name,
              description: booking.description,
              bookingFlags,
              startDate: dateForDateTimeInputValue(new Date(booking.from!)),
              endDate: dateForDateTimeInputValue(new Date(booking.to!)),
              custodianRef: custodian?.id || "", // We have an old bug that some users dont have a teamMember attached to them. This is a safety just so the UI doesnt break until we solve the data
            }}
          />
        </Card>
        <Card className="-mx-4 my-0 lg:mx-0 lg:w-1/3">
          <BookingStatistics
            duration={formatBookingDuration(booking.from!, booking.to!)}
            totalAssets={totalAssets}
            kitsCount={totalKits}
            assetsCount={assetsCount}
            totalValue={formatCurrency({
              value: totalValue,
              locale: hints.locale,
              currency: currentOrganization.currency,
            })}
            allCategories={allCategories}
          />
        </Card>
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
