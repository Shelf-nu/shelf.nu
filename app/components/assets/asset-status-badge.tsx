import { AssetStatus } from "@prisma/client";
import { Badge } from "../shared";

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
  status,
  availableToBook = true,
}: {
  status: AssetStatus;
  availableToBook: boolean;
}) {
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  if (!availableToBook) {
    return <Badge color="#B42318">Unavailable</Badge>;
  }
  return (
    <Badge color={assetStatusColorMap(status)}>
      {userFriendlyAssetStatus(status)}
    </Badge>
  );
}
