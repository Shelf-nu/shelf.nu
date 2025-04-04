import { AssetStatus } from "@prisma/client";
import AwaitingSignatureTooltip from "../custody/awaiting-signature-tooltip";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";
import When from "../when/when";

export const userFriendlyAssetStatus = (status: AssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    case AssetStatus.SIGNATURE_PENDING:
      return "Signature Pending";
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
    case AssetStatus.SIGNATURE_PENDING:
      return "#B54708";
    default:
      return "#12B76A";
  }
};

export function AssetStatusBadge({
  status,
  availableToBook = true,
  assetId,
}: {
  status: AssetStatus;
  availableToBook: boolean;
  assetId: string;
}) {
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <Badge color={assetStatusColorMap(status)}>
        {userFriendlyAssetStatus(status)}
      </Badge>

      <When
        truthy={status === AssetStatus.SIGNATURE_PENDING && !!assetId}
        fallback={
          <Badge color={assetStatusColorMap(status)}>
            {userFriendlyAssetStatus(status)}
          </Badge>
        }
      >
        <AwaitingSignatureTooltip
          assetId={assetId!}
          trigger={
            <Badge
              color={assetStatusColorMap(status)}
              className={"bg-warning-50"}
            >
              {userFriendlyAssetStatus(status)}
            </Badge>
          }
        />
      </When>

      {!availableToBook && (
        <UnavailableBadge title="This asset is marked as unavailable for bookings" />
      )}
    </div>
  );
}
