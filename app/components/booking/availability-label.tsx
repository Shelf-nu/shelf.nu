import type { Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { Link, useLoaderData } from "@remix-run/react";
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.manage-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.manage-kits";
import { SERVER_URL } from "~/utils/env";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";
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
  isAlreadyAdded,
}: {
  asset: AssetWithBooking;
  isCheckedOut: boolean;
  showKitStatus?: boolean;
  isAddedThroughKit?: boolean;
  isAlreadyAdded?: boolean;
}) {
  const { booking } = useLoaderData<{ booking: Booking }>();
  const isPartOfKit = !!asset.kitId;

  /** User scanned the asset and it is already in booking */
  if (isAlreadyAdded) {
    return (
      <AvailabilityBadge
        badgeText="Already added to this booking"
        tooltipTitle="Asset is part of booking"
        tooltipContent="This asset is already added to the current booking."
      />
    );
  }

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
   * Is booked for period - using client-side helper function
   */
  if (hasAssetBookingConflicts(asset, booking.id)) {
    const conflictingBooking = asset?.bookings?.find(
      (b) =>
        b.status === BookingStatus.ONGOING ||
        b.status === BookingStatus.OVERDUE ||
        b.status === BookingStatus.RESERVED
    );
    return (
      <AvailabilityBadge
        badgeText={"Already booked"}
        tooltipTitle={"Asset is already part of a booking"}
        tooltipContent={
          conflictingBooking ? (
            <span>
              This asset is added to a booking (
              <Button
                to={`${SERVER_URL}/bookings/
                ${conflictingBooking.id}`}
                target="_blank"
                variant={"inherit"}
                className={"!underline"}
              >
                {conflictingBooking?.name}
              </Button>
              ) that is overlapping the selected time period.
            </span>
          ) : (
            "This asset is added to a booking that is overlapping the selected time period."
          )
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

  return null;
}

export function AvailabilityBadge({
  badgeText,
  tooltipTitle,
  tooltipContent,
  className,
}: {
  badgeText: string;
  tooltipTitle: string;
  tooltipContent: string | React.ReactNode;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={tw(
              "inline-block  bg-warning-50 px-[6px] py-[2px]",
              "rounded-md border border-warning-200",
              "text-xs text-warning-700",
              "availability-badge",
              className
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
 * 3. Some of the assets are in custody
 * 4. Some of the assets are already booked for that period (for that booking)
 * 5. If kit has no assets
 */
export function getKitAvailabilityStatus(
  kit: KitForBooking,
  currentBookingId: string
) {
  // Kit is checked out if it's not AVAILABLE and has conflicting bookings
  // Use centralized booking conflict logic
  const isCheckedOut =
    kit.status !== "AVAILABLE" &&
    kit.assets.some((asset) =>
      hasAssetBookingConflicts(asset, currentBookingId)
    );

  const isInCustody =
    kit.status === "IN_CUSTODY" || kit.assets.some((a) => Boolean(a.custody));

  const isKitWithoutAssets = kit.assets.length === 0;

  const someAssetMarkedUnavailable = kit.assets.some((a) => !a.availableToBook);

  // Apply same booking conflict logic as isCheckedOut
  const someAssetHasUnavailableBooking = kit.assets.some((asset) =>
    hasAssetBookingConflicts(asset, currentBookingId)
  );

  return {
    isCheckedOut,
    isInCustody,
    isKitWithoutAssets,
    someAssetMarkedUnavailable,
    someAssetHasUnavailableBooking,
    isKitUnavailable: [isInCustody, isKitWithoutAssets].some(Boolean),
  };
}

export function KitAvailabilityLabel({ kit }: { kit: KitForBooking }) {
  const { booking } = useLoaderData<{ booking: Booking }>();

  const {
    isCheckedOut,
    someAssetMarkedUnavailable,
    isInCustody,
    isKitWithoutAssets,
    someAssetHasUnavailableBooking,
  } = getKitAvailabilityStatus(kit, booking.id);

  if (isInCustody) {
    return (
      <AvailabilityBadge
        badgeText="In custody"
        tooltipTitle="Kit is in custody"
        tooltipContent="This kit is in custody or it contains some assets that are in custody."
      />
    );
  }

  if (isCheckedOut) {
    return (
      <AvailabilityBadge
        badgeText="Checked out"
        tooltipTitle="Kit is checked out"
        tooltipContent="This kit is currently checked out as part of another booking."
      />
    );
  }

  if (isKitWithoutAssets) {
    return (
      <AvailabilityBadge
        badgeText="No assets"
        tooltipTitle="No assets in kit"
        tooltipContent="There are no assets added to this kit yet."
      />
    );
  }

  if (someAssetMarkedUnavailable) {
    return (
      <AvailabilityBadge
        badgeText="Contains non-bookable assets"
        tooltipTitle="Kit is unavailable for check-out"
        tooltipContent="Some assets in this kit are marked as non-bookable. You can still add the kit to your booking, but you must remove the non-bookable assets to proceed with check-out."
      />
    );
  }

  if (someAssetHasUnavailableBooking) {
    return (
      <AvailabilityBadge
        badgeText="Already booked"
        tooltipTitle="Kit is already part of a booking"
        tooltipContent="This kit is already added to another booking."
      />
    );
  }

  return null;
}
