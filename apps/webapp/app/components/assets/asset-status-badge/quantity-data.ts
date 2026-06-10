/**
 * Quantity Breakdown Data
 *
 * Pure derivations + types behind the asset status badge's quantity-
 * aware rendering: aggregating custody / booking slices off the asset
 * record, then picking the right "Partially X" / "X" label + color.
 *
 * Lives outside the badge component so non-React consumers (server
 * loaders, tests) can share the shape. The lazy-fetch API endpoint
 * at `/api/assets/$assetId/quantity-breakdown` returns data conforming
 * to {@link QuantityAwareAsset} so the client can feed it straight
 * into {@link getQuantityData}.
 *
 * @see {@link file://./quantity-tooltip-content.tsx}
 * @see {@link file://./asset-status-badge.tsx}
 */

import type { AssetType } from "@prisma/client";
import { isQuantityTracked } from "~/modules/asset/utils";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";

/** Shape for a booking-asset pivot record with quantity and booking info */
export interface BookingAssetRecord {
  quantity?: number;
  /** Set when this slice is kit-driven (Polish-6 discriminator); null/undefined for standalone slices */
  assetKitId?: string | null;
  booking?: {
    id?: string;
    name?: string;
    status?: string;
  };
  [key: string]: unknown;
}

/** Shape for an asset-kit pivot record used to resolve kit names from assetKitId */
export interface AssetKitRecord {
  id?: string;
  kit?: { id?: string; name?: string } | null;
  [key: string]: unknown;
}

/**
 * Minimal asset shape needed for quantity-aware status display.
 * Kept lightweight so any call site with the asset object can pass it.
 */
export interface QuantityAwareAsset {
  type?: AssetType | null;
  quantity?: number | null;
  custody?:
    | Array<{ quantity?: number; [key: string]: unknown }>
    | { quantity?: number; [key: string]: unknown }
    | null;
  /** Booking-asset pivot records for quantity-tracked booking display */
  bookingAssets?: BookingAssetRecord[] | null;
  /** AssetKit pivot records so the tooltip can resolve kit names from `BookingAsset.assetKitId` */
  assetKits?: AssetKitRecord[] | null;
  /** Allow additional properties so any asset-like object can be passed */
  [key: string]: unknown;
}

/**
 * Computes quantity breakdown from an asset's custody and booking records.
 * Returns null for non-quantity-tracked assets or when there is no custody
 * or booking data to display.
 */
export function getQuantityData(asset?: QuantityAwareAsset | null) {
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

  /* AssetKit lookup so the tooltip can resolve a kit name from a
   * BookingAsset row's `assetKitId` (kit-driven slice attribution). */
  const assetKits: AssetKitRecord[] = Array.isArray(asset.assetKits)
    ? asset.assetKits
    : [];

  return {
    total,
    inCustody,
    reserved,
    checkedOut,
    available,
    bookingAssets,
    assetKits,
  };
}

/** Return type from getQuantityData (non-null case) */
export type QuantityBreakdown = NonNullable<ReturnType<typeof getQuantityData>>;

/**
 * Determines the badge label and color scheme based on the quantity
 * breakdown across custody and bookings.
 *
 * Priority order: checked out > in custody > reserved.
 * Uses "Partially …" prefix when some units are still available.
 */
export function getQuantityBadgeLabelAndColor(data: QuantityBreakdown): {
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
