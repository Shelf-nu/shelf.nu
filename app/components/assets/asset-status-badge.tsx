import { useMemo } from "react";
import type { Booking } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import useApiQuery from "~/hooks/use-api-query";
import type { ExtendedAssetStatus } from "~/utils/booking-assets";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import { UnavailableBadge } from "../shared/unavailable-badge";
import When from "../when/when";

/**
 * We have a special status called CHECKED_IN which is only valid within a booking context
 * This status indicates that the asset has been checked in by the user within that current booking
 */
export const userFriendlyAssetStatus = (status: ExtendedAssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    case "PARTIALLY_CHECKED_IN":
      return "Already checked in";
    default:
      return "Available";
  }
};

export const assetStatusColorMap = (status: ExtendedAssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
    case "PARTIALLY_CHECKED_IN":
      return "#2E90FA";
    case AssetStatus.CHECKED_OUT:
      return "#5925DC";
    default:
      return "#12B76A";
  }
};

export function AssetStatusBadge({
  id,
  status,
  availableToBook = true,
}: {
  id: string;
  status: ExtendedAssetStatus;
  availableToBook: boolean;
}) {
  // Fetch the booking from API when asset is CHECKED_OUT
  // The API correctly finds the booking where asset is checked out
  // (excluding bookings where it's been partially checked in)
  const { data } = useApiQuery<Booking>({
    api: `/api/assets/${id}/ongoing-booking`,
    enabled: status === AssetStatus.CHECKED_OUT,
  });

  const bookingToShow = useMemo(() => {
    if (status !== AssetStatus.CHECKED_OUT) {
      return null;
    }

    return data;
  }, [data, status]);

  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <HoverCard openDelay={0}>
      <HoverCardTrigger asChild>
        <button className="flex items-center gap-1.5">
          <Badge color={assetStatusColorMap(status)}>
            {userFriendlyAssetStatus(status)}
          </Badge>
          {!availableToBook && (
            <UnavailableBadge title="This asset is marked as unavailable for bookings" />
          )}
        </button>
      </HoverCardTrigger>

      <When truthy={!!bookingToShow}>
        <HoverCardPortal>
          <HoverCardContent side="top" className="w-max min-w-36 max-w-72">
            <Button
              variant="link-gray"
              to={`/bookings/${bookingToShow?.id}`}
              target="_blank"
            >
              {bookingToShow?.name}
            </Button>
          </HoverCardContent>
        </HoverCardPortal>
      </When>
    </HoverCard>
  );
}
