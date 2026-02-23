import { BookingStatus } from "@prisma/client";
import { useLoaderData } from "react-router";
import { formatBookingDuration } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import { dateForDateTimeInputValue } from "~/utils/date-fns";
import { BookingAssetsColumn } from "./booking-assets-column";
import { BookingStatistics } from "./booking-statistics";
import { EditBookingForm } from "./forms/edit-booking-form";
import { Card } from "../shared/card";

export function BookingPageContent() {
  const {
    booking,
    teamMembers,
    teamMembersForForm,
    bookingFlags,
    totalAssets,
    totalKits,
    totalValue,
    allCategories,
    assetsCount,
    partialCheckinProgress,
  } = useLoaderData<BookingPageLoaderData>();

  // For finding the custodian, use teamMembersForForm which guarantees custodian availability
  // Prioritize custodianTeamMemberId if it exists, otherwise match by userId
  const custodian = (teamMembersForForm || teamMembers).find((member) =>
    booking.custodianTeamMemberId
      ? booking.custodianTeamMemberId === member.id
      : booking.custodianUserId === member?.userId
  );

  return (
    <div className="md:mt-4">
      {booking.status === BookingStatus.CANCELLED &&
        booking.cancellationReason && (
          <div className="mb-4 rounded-lg border border-warning-200 bg-warning-25 p-4">
            <p className="mb-1 text-sm font-semibold ">Cancellation reason</p>
            <p className="text-sm ">{booking.cancellationReason}</p>
          </div>
        )}
      <div className="mb-8 flex h-full flex-col items-stretch gap-2 lg:mb-2 lg:flex-row">
        <Card className="-mx-4 my-0 lg:mx-0 lg:w-2/3">
          <EditBookingForm
            booking={{
              id: booking.id,
              status: booking.status,
              name: booking.name,
              description: booking.description,
              bookingFlags,
              startDate: dateForDateTimeInputValue(new Date(booking.from)),
              endDate: dateForDateTimeInputValue(new Date(booking.to)),
              custodianRef: custodian?.id || "", // We have an old bug that some users dont have a teamMember attached to them. This is a safety just so the UI doesnt break until we solve the data
              tags: booking.tags,
            }}
          />
        </Card>
        <Card className="-mx-4 my-0 lg:mx-0 lg:w-1/3">
          <BookingStatistics
            duration={formatBookingDuration(booking.from, booking.to)}
            totalAssets={totalAssets}
            kitsCount={totalKits}
            assetsCount={assetsCount}
            totalValue={totalValue}
            partialCheckinProgress={partialCheckinProgress}
            allCategories={allCategories}
            tags={booking.tags}
            creator={booking.creator}
          />
        </Card>
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
