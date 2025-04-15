import { KitStatus } from "@prisma/client";
import { userFriendlyAssetStatus } from "../assets/asset-status-badge";
import AwaitingSignatureTooltip from "../custody/awaiting-signature-tooltip";
import { Badge } from "../shared/badge";
import { UnavailableBadge } from "../shared/unavailable-badge";
import When from "../when/when";

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
    case KitStatus.SIGNATURE_PENDING:
      return "#B54708";
    default:
      return "#12B76A";
  }
};

export function KitStatusBadge({
  status,
  availableToBook = true,
  kitId,
}: {
  status: KitStatus;
  availableToBook: boolean;
  kitId?: string;
}) {
  return (
    <div className="flex items-center gap-[6px]">
      <When
        truthy={status === KitStatus.SIGNATURE_PENDING && !!kitId}
        fallback={
          <Badge color={assetStatusColorMap(status)}>
            {userFriendlyAssetStatus(status)}
          </Badge>
        }
      >
        <AwaitingSignatureTooltip
          type="kit"
          navigateTo={`/kits/${kitId}/share-agreement`}
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
        <UnavailableBadge title="This kit is not available for Bookings because some of its assets are marked as unavailable" />
      )}
    </div>
  );
}
