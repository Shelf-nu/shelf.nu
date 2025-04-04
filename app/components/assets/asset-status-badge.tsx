import { AssetStatus } from "@prisma/client";
import colors from "tailwindcss/colors";
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
  isSignaturePending,
  assetId,
}: {
  status: AssetStatus;
  availableToBook: boolean;
  isSignaturePending?: boolean;
  assetId?: string;
}) {
  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <When
        truthy={isSignaturePending && !!assetId}
        fallback={
          <Badge color={assetStatusColorMap(status)}>
            {userFriendlyAssetStatus(status)}
          </Badge>
        }
      >
        <AwaitingSignatureTooltip
          assetId={assetId!}
          trigger={
            <button>
              <Badge color={colors.gray["500"]}>Signature pending</Badge>
            </button>
          }
        />
      </When>
      {!availableToBook && (
        <UnavailableBadge title="This asset is marked as unavailable for bookings" />
      )}
    </div>
  );
}
