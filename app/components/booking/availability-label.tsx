import type { Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { Link, useLoaderData } from "@remix-run/react";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { SERVER_URL, tw } from "~/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/**
 * There are 3 reasons an asset can be unavailable:
 * 1. Its marked as not allowed for booking
 * 2. It is already in custody
 * 3. It is already booked for that period (within another booking)
 *
 * Each reason has its own tooltip and label
 */
export function AvailabilityLabel({
  asset,
  isCheckedOut,
}: {
  asset: AssetWithBooking;
  isCheckedOut: boolean;
}) {
  const { booking } = useLoaderData<{ booking: Booking }>();
  /**
   * Marked as not allowed for booking
   */

  if (!asset.availableToBook) {
    return (
      <AvailabilityBadge
        badgeText={"Unavailable"}
        tooltipTitle={"Asset is unavailable for bookings"}
        tooltipContent={
          "This asset is marked as unavailable for bookings by an administrator."
        }
      />
    );
  }

  /**
   * Has custody
   */
  if (asset.custody) {
    return (
      <AvailabilityBadge
        badgeText={"In custody"}
        tooltipTitle={"Asset is in custody"}
        tooltipContent={
          "This asset is in custody of a team member making it currently unavailable for bookings."
        }
      />
    );
  }

  /**
   * Is booked for period
   */
  // Important not here is that the asset.bookings have to be queried/filtered based on the same date range as the current booking
  if (
    asset.bookings?.length > 0 &&
    asset.bookings.some((b) => b.id !== booking?.id)
  ) {
    return (
      <AvailabilityBadge
        badgeText={"Already booked"}
        tooltipTitle={"Asset is already part of a booking"}
        tooltipContent={
          "This asset is added to a booking that is overlapping the selected time period."
        }
      />
    );
  }

  /**
   * Is currently checked out
   */

  if (isCheckedOut) {
    /** We get the current active booking that the asset is checked out to so we can use its name in the tooltip contnet
     * NOTE: This will currently not work as we are returning only overlapping bookings with the query. I leave to code and we can solve it by modifying the DB queries: https://github.com/Shelf-nu/shelf.nu/pull/555#issuecomment-1877050925
     */
    const currentBooking = asset?.bookings?.find(
      (b) =>
        b.status === BookingStatus.ONGOING || b.status === BookingStatus.OVERDUE
    );

    return (
      <AvailabilityBadge
        badgeText={"Checked out"}
        tooltipTitle={"Asset is currently checked out"}
        tooltipContent={
          currentBooking ? (
            <span>
              This asset is currently checked out as part of another booking ( -{" "}
              <Link
                to={`${SERVER_URL}/bookings/
                ${currentBooking.id}`}
                target="_blank"
              >
                {currentBooking?.name}
              </Link>
              ) and should be available for your selected date range period
            </span>
          ) : (
            "This asset is currently checked out as part of another booking and should be available for your selected date range period"
          )
        }
      />
    );
  }

  return null;
}

export function AvailabilityBadge({
  badgeText,
  tooltipTitle,
  tooltipContent,
}: {
  badgeText: string;
  tooltipTitle: string;
  tooltipContent: string | JSX.Element;
}) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={tw(
              "inline-block bg-warning-50 px-[6px] py-[2px]",
              "rounded-md border border-warning-200",
              "text-xs text-warning-700"
            )}
          >
            {badgeText}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <div className="max-w-[260px] text-left sm:max-w-[320px]">
            <h6 className="mb-1 text-xs font-semibold text-gray-700">
              {tooltipTitle}
            </h6>
            <div className="whitespace-normal text-xs font-medium text-gray-500">
              {tooltipContent}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
