import type { Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { Link, useLoaderData } from "@remix-run/react";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";
import { SERVER_URL } from "~/utils/env";
import { tw } from "~/utils/tw";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

/**
 * There are 4 reasons an asset can be unavailable:
 * 1. Its marked as not allowed for booking
 * 2. It is already in custody
 * 3. It is already booked for that period (within another booking)
 * 4. It is part of a kit and user is trying to add it individually
 * Each reason has its own tooltip and label
 */
export function AvailabilityLabel({
  asset,
  isCheckedOut,
  showKitStatus,
  isAddedThroughKit,
}: {
  asset: AssetWithBooking;
  isCheckedOut: boolean;
  showKitStatus?: boolean;
  isAddedThroughKit?: boolean;
}) {
  const isPartOfKit = !!asset.kitId;

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

  /**
   * User is viewing all assets and the assets is added in a booking through kit
   */
  if (isAddedThroughKit) {
    return (
      <AvailabilityBadge
        badgeText="Added through kit"
        tooltipTitle="Asset was added through a kit"
        tooltipContent="Remove the asset from the kit to add it individually."
      />
    );
  }

  /**
   * Asset is part of a kit
   */
  if (isPartOfKit && showKitStatus) {
    return (
      <AvailabilityBadge
        badgeText="Part of kit"
        tooltipTitle="Asset is part of a kit"
        tooltipContent="Remove the asset from the kit to add it individually."
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

/**
 * A kit is not available for the following reasons
 * 1. Kit has unavailable status
 * 2. Kit or some asset is in custody
 * 3. Kit is checked out
 * 4. Some of the assets are marked as unavailable
 * 5. Some of the assets are in custody
 * 6. Some of the assets are already booked for that period (for that booking)
 * 7. If kit has no assets
 */
export function KitAvailabilityLabel({ kit }: { kit: KitForBooking }) {
  const { booking } = useLoaderData<{ booking: Booking }>();

  const kitBookings = kit.assets.length ? kit.assets[0].bookings : [];

  /** A kit is checked out if any asset of it is part or other CHECKED_OUT booking */
  const isCheckedOut = kit.assets.some(
    (a) =>
      (a.status === "CHECKED_OUT" &&
        !a.bookings.some((b) => b.id === booking.id)) ??
      false
  );

  /** Assets are marked as unavailable */
  if (kit.assets.some((a) => !a.availableToBook)) {
    return (
      <AvailabilityBadge
        badgeText="Unavailable"
        tooltipTitle="Kit is unavailable for booking"
        tooltipContent="Some of the assets of this kits are marked as unavailable for booking by an administrator."
      />
    );
  }

  /** In custody */
  if (
    kit.status === "IN_CUSTODY" ||
    kit.assets.some((a) => Boolean(a.custody))
  ) {
    return (
      <AvailabilityBadge
        badgeText="In custody"
        tooltipTitle="Kit is in custody"
        tooltipContent="This kit is in custody or it contains some assets that are in custody make it currently unavailable for bookings."
      />
    );
  }

  /** Checked out */
  if (isCheckedOut) {
    return (
      <AvailabilityBadge
        badgeText="Checked out"
        tooltipTitle="Kit is checked out"
        tooltipContent="This kit is currently checked out as part of another booking."
      />
    );
  }

  /** Kit is booked for the period */
  if (kitBookings.length && kitBookings.some((b) => b.id !== booking.id)) {
    return (
      <AvailabilityBadge
        badgeText="Already booked"
        tooltipTitle="Kit is already part of a booking"
        tooltipContent="This kit is added to a booking that is overlapping the selected time period."
      />
    );
  }

  /** Kit has not assets */
  if (!kit.assets.length) {
    return (
      <AvailabilityBadge
        badgeText="No assets"
        tooltipTitle="No assets in kit"
        tooltipContent="There are no assets added to this kit yet."
      />
    );
  }

  return null;
}

export function isKitUnavailableForBooking(
  kit: KitForBooking,
  currentBookingId: string
) {
  const kitBookings = kit.assets.length ? kit.assets[0].bookings : [];

  const isCheckedOut = kit.assets.some(
    (a) =>
      (a.status === "CHECKED_OUT" &&
        !a.bookings.some((b) => b.id === currentBookingId)) ??
      false
  );

  const assetNotAvailable = kit.assets.some((a) => !a.availableToBook);

  const isInCustody =
    kit.status === "IN_CUSTODY" || kit.assets.some((a) => Boolean(a.custody));

  const bookedForPeriod =
    kitBookings.length && kitBookings.some((b) => b.id !== currentBookingId);

  const isKitWithoutAssets = kit.assets.length === 0;

  return [
    isCheckedOut,
    assetNotAvailable,
    isInCustody,
    bookedForPeriod,
    isKitWithoutAssets,
  ].some(Boolean);
}
