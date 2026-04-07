import { useMemo } from "react";
import type { AssetType, Booking } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import useApiQuery from "~/hooks/use-api-query";
import { isQuantityTracked } from "~/modules/asset/utils";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import type { ExtendedAssetStatus } from "~/utils/booking-assets";
import { Badge } from "../shared/badge";
import { Button } from "../shared/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
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

export const assetStatusColorMap = (
  status: ExtendedAssetStatus
): BadgeColorScheme => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return BADGE_COLORS.blue;
    case "PARTIALLY_CHECKED_IN":
      return BADGE_COLORS.blue;
    case AssetStatus.CHECKED_OUT:
      return BADGE_COLORS.violet;
    default:
      // AVAILABLE
      return BADGE_COLORS.green;
  }
};

/**
 * Minimal asset shape needed for quantity-aware status display.
 * Kept lightweight so any call site with the asset object can pass it.
 */
interface QuantityAwareAsset {
  type?: AssetType | null;
  quantity?: number | null;
  custody?:
    | Array<{ quantity?: number; [key: string]: unknown }>
    | { quantity?: number; [key: string]: unknown }
    | null;
  /** Allow additional properties so any asset-like object can be passed */
  [key: string]: unknown;
}

/**
 * Computes quantity breakdown from an asset's custody records.
 * Returns null for non-quantity-tracked assets or when custody data
 * is not available.
 */
function getQuantityData(asset?: QuantityAwareAsset | null) {
  if (!asset || !isQuantityTracked(asset)) return null;
  const total = asset.quantity ?? 0;
  const custodyArray = Array.isArray(asset.custody)
    ? asset.custody
    : asset.custody
    ? [asset.custody]
    : [];
  if (custodyArray.length === 0) return null;
  const inCustody = custodyArray.reduce((sum, c) => sum + (c.quantity ?? 0), 0);
  return { total, inCustody, available: total - inCustody };
}

export function AssetStatusBadge({
  id,
  status,
  availableToBook = true,
  asset,
}: {
  id: string;
  status: ExtendedAssetStatus;
  availableToBook: boolean;
  /**
   * When provided, the badge auto-detects quantity-tracked assets and
   * renders a quantity-aware status (e.g., "Partial custody") with a
   * tooltip showing the breakdown. The asset must include `type`,
   * `quantity`, and `custody` fields for quantity display to work.
   * Falls back to standard status if data is missing.
   */
  asset?: QuantityAwareAsset | null;
}) {
  const quantityData = useMemo(() => getQuantityData(asset), [asset]);

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

  /**
   * For quantity-tracked assets with custody data, display a
   * quantity-aware status:
   * - All available → falls through to standard "Available" (green)
   * - Some in custody → "Partial custody" (blue) with tooltip
   * - All in custody → "In custody" (blue) with tooltip
   */
  if (quantityData && quantityData.inCustody > 0) {
    const isFullCustody = quantityData.available === 0;
    const label = isFullCustody ? "In custody" : "Partial custody";
    const colors = BADGE_COLORS.blue;

    return (
      <span className="flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Badge color={colors.bg} textColor={colors.text}>
                  {label}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {quantityData.inCustody} of {quantityData.total} in custody
                {" — "}
                {quantityData.available} available
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {!availableToBook && (
          <UnavailableBadge title="This asset is marked as unavailable for bookings" />
        )}
      </span>
    );
  }

  // If the asset is not available to book, it is unavailable
  // We handle this on front-end as syncing status with the flag is very complex on backend and error prone so this is the lesser evil
  const colors = assetStatusColorMap(status);
  return (
    <HoverCard openDelay={0}>
      <HoverCardTrigger asChild>
        <span className="flex items-center gap-1.5">
          <Badge color={colors.bg} textColor={colors.text}>
            {userFriendlyAssetStatus(status)}
          </Badge>
          {!availableToBook && (
            <UnavailableBadge title="This asset is marked as unavailable for bookings" />
          )}
        </span>
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
