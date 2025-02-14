import { KitStatus } from "@prisma/client";
import { userFriendlyAssetStatus } from "../assets/asset-status-badge";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

export function userFriendlyKitStatus(status: KitStatus) {
  switch (status) {
    case KitStatus.IN_CUSTODY:
      return "In Custody";
    case KitStatus.CHECKED_OUT:
      return "Checked Out";
    default:
      return "Available";
  }
}

export const assetStatusColorMap = (status: KitStatus) => {
  switch (status) {
    case KitStatus.IN_CUSTODY:
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
  status: KitStatus;
  availableToBook: boolean;
}) {
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status)}>
        {userFriendlyAssetStatus(status)}
      </Badge>
      {!availableToBook && (
        <UnavailableBadge title="This kit is not available for Bookings because some of its assets are marked as unavailable" />
      )}
    </div>
  );
}
