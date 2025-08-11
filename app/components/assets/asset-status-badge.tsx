import { AssetStatus, Booking, BookingStatus } from "@prisma/client";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";
import useApiQuery from "~/hooks/use-api-query";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { useMemo } from "react";
import When from "../when/when";
import { Button } from "../shared/button";

export const userFriendlyAssetStatus = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    default:
      return "Available";
  }
};

export const assetStatusColorMap = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
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
  bookings,
}: {
  id: string;
  status: AssetStatus;
  availableToBook: boolean;
  bookings?: Pick<Booking, "id" | "name" | "status">[];
}) {
  const booking = bookings?.find(
    (b) =>
      b.status === BookingStatus.ONGOING || b.status === BookingStatus.OVERDUE
  );

  const { data, isLoading } = useApiQuery<Booking>({
    api: `/api/assets/${id}/ongoing-booking`,
    enabled: status === AssetStatus.CHECKED_OUT && !booking,
  });

  const bookingToShow = useMemo(() => {
    if (status !== AssetStatus.CHECKED_OUT) {
      return null;
    }

    if (booking) {
      return booking;
    }

    return data;
  }, [booking, data, status]);

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
