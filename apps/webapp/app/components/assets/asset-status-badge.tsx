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
    case "PARTIALLY_CHECKED_IN_QTY":
      // Qty-tracked: some units dispositioned, some still outstanding.
      // Distinct wording so users know the asset isn't fully done.
      return "Partially checked in";
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
    case "PARTIALLY_CHECKED_IN_QTY":
      // Amber to signal "action still required" — there's work left on
      // this row, unlike the solid blue "done for this row" state.
      return BADGE_COLORS.amber;
    case AssetStatus.CHECKED_OUT:
      return BADGE_COLORS.violet;
    default:
      // AVAILABLE
      return BADGE_COLORS.green;
  }
};

/** Shape for a booking-asset pivot record with quantity and booking info */
interface BookingAssetRecord {
  quantity?: number;
  booking?: {
    id?: string;
    name?: string;
    status?: string;
  };
  [key: string]: unknown;
}

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
  /** Booking-asset pivot records for quantity-tracked booking display */
  bookingAssets?: BookingAssetRecord[] | null;
  /** Allow additional properties so any asset-like object can be passed */
  [key: string]: unknown;
}

/**
 * Computes quantity breakdown from an asset's custody and booking records.
 * Returns null for non-quantity-tracked assets or when there is no custody
 * or booking data to display.
 */
function getQuantityData(asset?: QuantityAwareAsset | null) {
  if (!asset || !isQuantityTracked(asset)) return null;

  const total = asset.quantity ?? 0;

  /* --- Custody --- */
  const custodyArray = Array.isArray(asset.custody)
    ? asset.custody
    : asset.custody
    ? [asset.custody]
    : [];
  const inCustody = custodyArray.reduce((sum, c) => sum + (c.quantity ?? 0), 0);

  /* --- Bookings --- */
  const bookingAssets: BookingAssetRecord[] = Array.isArray(asset.bookingAssets)
    ? asset.bookingAssets
    : [];

  const reserved = bookingAssets
    .filter((ba) => ba.booking?.status === "RESERVED")
    .reduce((sum, ba) => sum + (ba.quantity ?? 0), 0);

  const checkedOut = bookingAssets
    .filter(
      (ba) =>
        ba.booking?.status === "ONGOING" || ba.booking?.status === "OVERDUE"
    )
    .reduce((sum, ba) => sum + (ba.quantity ?? 0), 0);

  /* Nothing to show — fall through to standard status badge */
  if (inCustody === 0 && reserved === 0 && checkedOut === 0) return null;

  const available = total - inCustody - reserved - checkedOut;

  return { total, inCustody, reserved, checkedOut, available, bookingAssets };
}

/** Return type from getQuantityData (non-null case) */
type QuantityBreakdown = NonNullable<ReturnType<typeof getQuantityData>>;

/**
 * Determines the badge label and color scheme based on the quantity
 * breakdown across custody and bookings.
 *
 * Priority order: checked out > in custody > reserved.
 * Uses "Partially …" prefix when some units are still available.
 */
function getQuantityBadgeLabelAndColor(data: QuantityBreakdown): {
  label: string;
  colors: BadgeColorScheme;
} {
  const { checkedOut, inCustody, reserved, available } = data;

  if (checkedOut > 0) {
    return {
      label: available <= 0 ? "Checked out" : "Partially checked out",
      colors: BADGE_COLORS.violet,
    };
  }

  if (inCustody > 0) {
    return {
      label: available <= 0 ? "In custody" : "Partial custody",
      colors: BADGE_COLORS.blue,
    };
  }

  if (reserved > 0) {
    return {
      label: available <= 0 ? "Reserved" : "Partially reserved",
      colors: BADGE_COLORS.blue,
    };
  }

  /* Fallback — shouldn't be reached because getQuantityData returns
   * null when all counts are zero, but be defensive */
  return { label: "Available", colors: BADGE_COLORS.green };
}

/**
 * Renders the rich tooltip content for a quantity-tracked asset.
 * Shows per-booking breakdown when bookings are involved, plus
 * custody and availability lines.
 */
function QuantityTooltipContent({ data }: { data: QuantityBreakdown }) {
  const { total, inCustody, reserved, checkedOut, available, bookingAssets } =
    data;

  /* Group booking-asset records by booking for the per-booking breakdown */
  const ongoingBookings: Array<{ name: string; quantity: number }> = [];
  const reservedBookings: Array<{ name: string; quantity: number }> = [];

  for (const ba of bookingAssets) {
    const bStatus = ba.booking?.status;
    const bName = ba.booking?.name ?? "Untitled booking";
    const qty = ba.quantity ?? 0;
    if (bStatus === "ONGOING" || bStatus === "OVERDUE") {
      ongoingBookings.push({ name: bName, quantity: qty });
    } else if (bStatus === "RESERVED") {
      reservedBookings.push({ name: bName, quantity: qty });
    }
  }

  return (
    <div className="space-y-1 text-xs">
      {/* Checked-out summary */}
      {checkedOut > 0 && (
        <div>
          <p className="font-semibold">
            {checkedOut} of {total} checked out
          </p>
          {ongoingBookings.map((b, i) => (
            <p key={i} className="pl-2 text-gray-300">
              • {b.name} — {b.quantity} {b.quantity === 1 ? "unit" : "units"}
            </p>
          ))}
        </div>
      )}

      {/* Reserved summary */}
      {reserved > 0 && (
        <div>
          <p className="font-semibold">
            {reserved} of {total} reserved
          </p>
          {reservedBookings.map((b, i) => (
            <p key={i} className="pl-2 text-gray-300">
              • {b.name} — {b.quantity} {b.quantity === 1 ? "unit" : "units"}
            </p>
          ))}
        </div>
      )}

      {/* Custody line (only when there's also booking data, otherwise
       * show a simpler format) */}
      {inCustody > 0 && (checkedOut > 0 || reserved > 0) && (
        <p>{inCustody} in custody</p>
      )}

      {/* Simple custody-only format (no bookings involved) */}
      {inCustody > 0 && checkedOut === 0 && reserved === 0 && (
        <p>
          {inCustody} of {total} in custody
        </p>
      )}

      {/* Available line */}
      <p className="text-gray-300">{available} available</p>
    </div>
  );
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

  const isQtyTracked = asset ? isQuantityTracked(asset) : false;

  // Fetch the ongoing booking from API when asset is CHECKED_OUT.
  // Skip for quantity-tracked assets — they handle multi-booking
  // display via the bookingAssets data passed in directly.
  const { data } = useApiQuery<Booking>({
    api: `/api/assets/${id}/ongoing-booking`,
    enabled: status === AssetStatus.CHECKED_OUT && !isQtyTracked,
  });

  const bookingToShow = useMemo(() => {
    if (status !== AssetStatus.CHECKED_OUT) {
      return null;
    }

    return data;
  }, [data, status]);

  /**
   * For quantity-tracked assets with custody/booking data, display a
   * quantity-aware status with an informative tooltip breakdown:
   * - Checked out in bookings → violet "Checked out" / "Partially checked out"
   * - In custody only → blue "In custody" / "Partial custody"
   * - Reserved only → blue "Reserved"
   * - Mixed states → badge for dominant state, full breakdown in tooltip
   */
  if (quantityData) {
    const { label, colors } = getQuantityBadgeLabelAndColor(quantityData);

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
            <TooltipContent side="bottom" className="max-w-xs">
              <QuantityTooltipContent data={quantityData} />
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
