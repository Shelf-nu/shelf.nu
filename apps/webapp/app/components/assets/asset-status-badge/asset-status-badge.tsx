/**
 * Asset Status Badge
 *
 * The badge shown next to an asset's title across the app. Picks the
 * right label + color from {@link ExtendedAssetStatus}, and for
 * QUANTITY_TRACKED assets renders a richer "Partially X" treatment
 * with a hover-card breakdown (standalone / via-kit slices, per
 * booking, custody, availability).
 *
 * **Performance:** the qty-aware breakdown is lazy-fetched on the
 * first cursor enter via `/api/assets/:id/quantity-breakdown` so an
 * index of 100 rows pays zero per-row cost up-front. When the asset
 * detail page passes `bookingAssets` + `assetKits` inline through
 * `asset`, the hover-card is instant.
 *
 * @see {@link file://./quantity-data.ts}
 * @see {@link file://./quantity-tooltip-content.tsx}
 * @see {@link file://./../../../routes/api+/assets.$assetId.quantity-breakdown.ts}
 */

import { useMemo, useState } from "react";
import type { Booking } from "@prisma/client";
import { AssetStatus } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import useApiQuery from "~/hooks/use-api-query";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { ExtendedAssetStatus } from "~/utils/booking-assets";
import {
  getQuantityBadgeLabelAndColor,
  getQuantityData,
  type QuantityAwareAsset,
} from "./quantity-data";
import { QuantityTooltipContent } from "./quantity-tooltip-content";
import { assetStatusColorMap, userFriendlyAssetStatus } from "./status-labels";
import { Badge } from "../../shared/badge";
import { Button } from "../../shared/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../shared/hover-card";
import { UnavailableBadge } from "../../shared/unavailable-badge";
import When from "../../when/when";

export function AssetStatusBadge({
  id,
  status,
  suppressQtyAware = false,
  availableToBook = true,
  asset,
}: {
  id: string;
  status: ExtendedAssetStatus;
  availableToBook: boolean;
  /**
   * Booking-row escape hatch for the qty-aware treatment. When `true`
   * AND the asset is `QUANTITY_TRACKED`, the badge:
   *
   *  1. Skips the lazy `/api/assets/:id/quantity-breakdown` fetch — no
   *     per-row fan-out on booking surfaces that render many rows.
   *  2. Renders the caller-supplied `status` via the plain
   *     `assetStatusColorMap` + `userFriendlyAssetStatus` shell (no
   *     "Partially X" relabeling, no hover-card breakdown).
   *
   * Booking rows have their own per-row signals (`InsufficientStockBadge`,
   * the row-local "Checked out N/M" pill, the dedicated check-IN/out
   * progress badges) that already convey the qty story for THIS booking;
   * the global qty breakdown would only add noise + spurious "Partially
   * X" relabels driven by other bookings' state. INDIVIDUAL assets are
   * unaffected — this flag is a no-op for them.
   *
   * Defaults to `false` so every existing caller keeps the rich qty-aware
   * behavior unchanged.
   */
  suppressQtyAware?: boolean;
  /**
   * When provided, the badge auto-detects quantity-tracked assets and
   * renders a quantity-aware status (e.g., "Partial custody") with a
   * tooltip showing the breakdown. The asset must include `type`,
   * `quantity`, and `custody` fields for quantity display to work.
   * Falls back to standard status if data is missing.
   */
  asset?: QuantityAwareAsset | null;
}) {
  const inlineQuantityData = useMemo(() => getQuantityData(asset), [asset]);

  // Whether the asset is actually QT (by schema type). Used to gate the
  // qty-aware render branch AND the `ongoing-booking` fetch (the latter
  // exists for INDIVIDUAL assets only).
  const isQtyTracked = asset ? isQuantityTracked(asset) : false;

  /**
   * Lazy-fetch the breakdown for qty-tracked assets that didn't get
   * `bookingAssets` from the loader (asset index, picker rows, scanner
   * drawer, etc.). The fetch is gated on `hasInteracted` so unhovered
   * rows on a 100-row index don't fan out N parallel requests. Once
   * the cursor enters the badge we kick the request off — by the time
   * the Radix hover-card opens (~150ms later) the data is usually ready.
   */
  const [hasInteracted, setHasInteracted] = useState(false);
  // `suppressQtyAware` also disables the lazy fetch: when the caller has
  // told us they don't want the qty-aware breakdown, paying the network
  // cost would be wasted bandwidth (the data isn't rendered).
  const needsLazyBreakdown =
    isQtyTracked && !inlineQuantityData && !suppressQtyAware;
  const { data: lazyAsset } = useApiQuery<QuantityAwareAsset>({
    api: `/api/assets/${id}/quantity-breakdown`,
    enabled: needsLazyBreakdown && hasInteracted,
  });
  const lazyQuantityData = useMemo(
    () => getQuantityData(lazyAsset ?? null),
    [lazyAsset]
  );
  const quantityData = inlineQuantityData ?? lazyQuantityData;

  // Fetch the ongoing booking from API when asset is CHECKED_OUT.
  // Skip for quantity-tracked assets — they handle multi-booking
  // display via the breakdown endpoint above. The `!isQtyTracked` check
  // also covers the `suppressQtyAware` case: on booking surfaces the row
  // status frequently is `CHECKED_OUT` (current booking is the one
  // checking it out), and triggering an `ongoing-booking` fan-out for
  // every QT row would be wasted work — the booking row already shows
  // the relevant context inline.
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
   * For quantity-tracked assets, render the qty-aware branch even before
   * the lazy fetch resolves. The label falls back to the asset's bare
   * status until the breakdown lands; on resolve, "Checked out" may refine
   * to "Partially checked out" etc. The hover-card stays empty until
   * either inline or lazy data is available — Radix HoverCard skips
   * rendering when the content is empty.
   */
  if (isQtyTracked) {
    /**
     * Booking-context pseudo-statuses (`PARTIALLY_CHECKED_IN`,
     * `PARTIALLY_CHECKED_IN_QTY`) are set by the caller when this row
     * is rendered inside a booking that's been (partially) checked in.
     * They describe the asset's state *for this specific booking* and
     * must win over the global qty-aware breakdown — otherwise an asset
     * that's been fully checked back inside a kit slice keeps showing
     * "Partially checked out" because its global `bookingAssets`
     * snapshot still reflects the reservation.
     */
    const isBookingContextStatus =
      status === "PARTIALLY_CHECKED_IN" ||
      status === "PARTIALLY_CHECKED_IN_QTY" ||
      status === "PARTIALLY_CHECKED_OUT_QTY" ||
      status === "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN";

    // When the caller has opted out via `suppressQtyAware`, the
    // caller-supplied `status` is authoritative — we never relabel based
    // on the global qty breakdown. This is what keeps an AVAILABLE QT
    // booking row reading as "Available" even though the global
    // `bookingAssets` snapshot might otherwise infer "Partial custody"
    // from other-booking/custody activity.
    const useCallerStatus =
      suppressQtyAware || isBookingContextStatus || !quantityData;

    const { label, colors } = useCallerStatus
      ? {
          label: userFriendlyAssetStatus(status),
          colors: assetStatusColorMap(status),
        }
      : getQuantityBadgeLabelAndColor(quantityData);

    return (
      <span
        className="flex items-center gap-1.5"
        onMouseEnter={
          needsLazyBreakdown && !hasInteracted
            ? () => setHasInteracted(true)
            : undefined
        }
      >
        <HoverCard openDelay={150} closeDelay={150}>
          <HoverCardTrigger asChild>
            <span>
              <Badge color={colors.bg} textColor={colors.text}>
                {label}
              </Badge>
            </span>
          </HoverCardTrigger>
          {/* Mirror the label decision: only mount the global qty
              breakdown when the qty-aware label is the one being shown.
              When `useCallerStatus` is true (booking-context status,
              `suppressQtyAware`, or no data yet), the chip is plain and
              the breakdown popover would be misleading — hide it. */}
          {!useCallerStatus && (
            <HoverCardPortal>
              <HoverCardContent
                side="bottom"
                className="w-[26rem] max-w-[calc(100vw-2rem)]"
              >
                <QuantityTooltipContent data={quantityData} />
              </HoverCardContent>
            </HoverCardPortal>
          )}
        </HoverCard>
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
