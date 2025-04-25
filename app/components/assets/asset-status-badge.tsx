import { useMemo } from "react";
import type { Kit } from "@prisma/client";
import { AssetStatus, KitStatus } from "@prisma/client";
import { useNavigate } from "@remix-run/react";
import { Badge } from "../shared/badge";
import { CustomTooltip } from "../shared/custom-tooltip";
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
  shareAgreementUrl,
  kit,
}: {
  status: AssetStatus;
  availableToBook: boolean;
  shareAgreementUrl: string;
  kit?: Pick<Kit, "id" | "name" | "status"> | null;
}) {
  const navigate = useNavigate();

  const isPartOfNotAvailableKit =
    kit &&
    (kit.status === KitStatus.IN_CUSTODY ||
      kit.status === KitStatus.SIGNATURE_PENDING);

  const inCustodyViaKit =
    status === AssetStatus.IN_CUSTODY && isPartOfNotAvailableKit;
  const signPendingViaKit =
    status === AssetStatus.SIGNATURE_PENDING && isPartOfNotAvailableKit;

  const showTooltip =
    status === AssetStatus.SIGNATURE_PENDING || inCustodyViaKit;

  const assetStatus = useMemo(() => {
    if (inCustodyViaKit) {
      return "In custody via kit";
    }

    if (signPendingViaKit) {
      return "Signature Pending via Kit";
    }

    return userFriendlyAssetStatus(status);
  }, [inCustodyViaKit, signPendingViaKit, status]);

  const tooltipContent = useMemo(() => {
    if (inCustodyViaKit) {
      return (
        <div>
          <h6 className="mb-1">In custody via kit</h6>
          <p className="text-xs text-gray-500">
            This asset has been assigned custody via a kit: {kit.name}.
          </p>
        </div>
      );
    }

    if (signPendingViaKit) {
      return (
        <div>
          <h6 className="mb-1">Signature pending via kit</h6>
          <p className="text-gray-500">
            This asset has been assigned custody via a kit: {kit.name}. The
            custody is still awaiting signature. To find more information go to
            the kit page.
          </p>
        </div>
      );
    }

    if (status === AssetStatus.SIGNATURE_PENDING) {
      return (
        <div>
          <h6 className="mb-1">Signature Pending</h6>
          <p className="text-gray-500">
            Asset status will change to "In custody" after signing. To cancel
            custody assignment, go to{" "}
            <span className="font-semibold text-gray-600">
              {"Actions > Release Custody"}
            </span>
          </p>
        </div>
      );
    }

    return null;
  }, [inCustodyViaKit, kit?.name, signPendingViaKit, status]);

  function handleClick(event: React.MouseEvent<HTMLSpanElement, MouseEvent>) {
    event.preventDefault();
    event.stopPropagation();

    if (status === AssetStatus.SIGNATURE_PENDING) {
      navigate(shareAgreementUrl);
    }
  }

  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  return (
    <div className="flex items-center gap-[6px]">
      <When
        truthy={showTooltip}
        fallback={
          <Badge color={assetStatusColorMap(status)}>{assetStatus}</Badge>
        }
      >
        <CustomTooltip content={tooltipContent}>
          <Badge
            color={assetStatusColorMap(status)}
            className="cursor-pointer bg-warning-50"
            onClick={handleClick}
          >
            {assetStatus}
          </Badge>
        </CustomTooltip>
      </When>

      {!availableToBook && (
        <UnavailableBadge title="This asset is marked as unavailable for bookings" />
      )}
    </div>
  );
}
