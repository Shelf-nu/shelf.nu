import { BookingStatus } from "@prisma/client";
import { archivedAssetsRefusal } from "@shelf/labels";
import { useLoaderData } from "react-router";
import { useCanArchiveAssets } from "~/hooks/use-can-archive-assets";
import { formatBookingDuration } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import {
  canAssignModelUnits,
  countUnassignedModelUnits,
} from "~/utils/booking-model-requests";
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
    unavailableAssets,
    archivedAssets,
    totalAssets,
    totalKits,
    totalValue,
    allCategories,
    assetsCount,
    lifecycleProgress,
  } = useLoaderData<BookingPageLoaderData>();

  // For finding the custodian, use teamMembersForForm which guarantees custodian availability
  // Prioritize custodianTeamMemberId if it exists, otherwise match by userId
  const custodian = (teamMembersForForm || teamMembers).find((member) =>
    booking.custodianTeamMemberId
      ? booking.custodianTeamMemberId === member.id
      : booking.custodianUserId === member?.userId
  );

  const canReinstate = useCanArchiveAssets();
  /**
   * Archived assets left in a booking that can still go out (in practice a
   * draft: archiving refuses reserved and checked-out bookings). Reserve and
   * check-out refuse them, so the page says so before anyone tries.
   */
  const showArchivedWarning =
    archivedAssets.length > 0 && canAssignModelUnits(booking.status);

  return (
    <div className="md:mt-4">
      {booking.status === BookingStatus.CANCELLED &&
        booking.cancellationReason && (
          <div className="mb-4 rounded-lg border border-warning-200 bg-warning-25 p-4">
            <p className="mb-1 text-sm font-semibold ">Cancellation reason</p>
            <p className="text-sm ">{booking.cancellationReason}</p>
          </div>
        )}
      {showArchivedWarning ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-warning-200 bg-warning-25 p-4"
        >
          <p className="mb-1 text-sm font-semibold">
            This booking holds archived assets
          </p>
          <p className="text-sm">
            {archivedAssetsRefusal({
              titles: archivedAssets.map((asset) => asset.title),
              fix: "remove-from-booking",
              canReinstate,
            })}{" "}
            Until then it can&apos;t be reserved or checked out.
          </p>
        </div>
      ) : null}
      <div className="mb-8 flex h-full flex-col items-stretch gap-2 lg:mb-2 lg:flex-row">
        <Card className="-mx-4 my-0 lg:mx-0 lg:w-2/3">
          <EditBookingForm
            booking={{
              id: booking.id,
              status: booking.status,
              name: booking.name,
              description: booking.description,
              bookingFlags,
              unavailableAssets,
              archivedAssets,
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
            unassignedModelUnits={countUnassignedModelUnits(
              booking.modelRequests
            )}
            canAssignModelUnits={canAssignModelUnits(booking.status)}
            totalValue={totalValue}
            lifecycleProgress={lifecycleProgress}
            allCategories={allCategories}
            tags={booking.tags}
            creator={booking.creator}
            autoArchivedAt={booking.autoArchivedAt}
            status={booking.status}
          />
        </Card>
      </div>
      <div className="flex-1">
        <BookingAssetsColumn />
      </div>
    </div>
  );
}
