import { AssetStatus } from "@prisma/client";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";

type ExtendedAssetStatus = AssetStatus | "PARTIALLY_CHECKED_IN";

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
  status,
  availableToBook = true,
}: {
  status: ExtendedAssetStatus;
  availableToBook: boolean;
}) {
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status)}>
        {userFriendlyAssetStatus(status)}
      </Badge>
      {!availableToBook && (
        <UnavailableBadge title="This asset is marked as unavailable for bookings" />
      )}
    </div>
  );
}
