import { KitStatus } from "@prisma/client";
import type { ExtendedKitStatus } from "~/utils/booking-assets";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

export function userFriendlyKitStatus(status: ExtendedKitStatus) {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return "In Custody";
    case KitStatus.CHECKED_OUT:
      return "Checked Out";
    case "PARTIALLY_CHECKED_IN":
      return "Already checked in";
    default:
      return "Available";
  }
}

export const assetStatusColorMap = (status: ExtendedKitStatus) => {
  switch (status) {
    case KitStatus.IN_CUSTODY:
    case "PARTIALLY_CHECKED_IN":
      return "#2E90FA";
    case KitStatus.CHECKED_OUT:
      return "#5925DC";
    default:
      return "#12B76A";
  }
};

export function KitStatusBadge({
  status,
  availableToBook = true,
}: {
  status: ExtendedKitStatus;
  availableToBook: boolean;
}) {
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status)}>
        {userFriendlyKitStatus(status)}
      </Badge>
      {!availableToBook && (
        <UnavailableBadge title="This kit is not available for Bookings because some of its assets are marked as unavailable" />
      )}
    </div>
  );
}
