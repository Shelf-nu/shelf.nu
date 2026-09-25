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
import { ASSET_QTY_STATUS_LABELS } from "@shelf/labels";
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
    /**
     * Booking start. Optional because not every loader selects it, a surface
     * that omits it simply renders no date rather than breaking. Serialised to
     * a string across the loader/fetcher boundary, hence the union.
     */
    from?: string | Date | null;
  };
  [key: string]: unknown;
}

/** Shape for an asset-kit pivot record used to resolve kit names from assetKitId */
export interface AssetKitRecord {
  id?: string;
  /**
   * Units of this asset allocated to that kit. Declared explicitly because the
   * index signature below would otherwise type it `unknown`, the field was
   * always selected and always present, just invisible to the compiler.
   */
  quantity?: number;
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
  /**
   * Start of the soonest upcoming booking, for surfaces that carry no
   * per-booking slices. The assets index is one: an asset may have hundreds of
   * future bookings and shipping them all per row would be absurd, so it sends
   * this one aggregate instead and the card still gets to say WHEN.
   */
  nextReservedFrom?: string | Date | null;
  /**
   * Units free to hand over right now, as the availability engine computes
   * it (`physicalAvailable`, clamped at 0). Loaders that have it pass it, and
   * the tooltip then quotes the same figure as the asset page and the index.
   * Without it the reducer derives it from the rows, which cannot tell
   * kit-held custody or kit units out on a booking apart from loose ones.
   */
  freeNow?: number | null;
  /** Allow additional properties so any asset-like object can be passed */
  [key: string]: unknown;
}

/**
 * Computes quantity breakdown from an asset's custody and booking records.
 * Returns null for non-quantity-tracked assets or when there is no custody
 * or booking data to display.
 *
 * IMPORTANT — `bookingAssets[].quantity` contract for ONGOING/OVERDUE rows:
 * For booking rows whose status is ONGOING or OVERDUE, the `quantity` on
 * each `BookingAssetRecord` MUST be the SERVER-COMPUTED effective claimed
 * count for this asset on that booking — i.e. the booked quantity AFTER
 * subtracting any `PartialBookingCheckout` claims attributed to the asset
 * (Wave-B aligned-array attribution with legacy fallback). It is NOT the
 * raw `BookingAsset.quantity` snapshot from the pivot table.
 *
 * Loaders / the lazy-fetch quantity-breakdown API endpoint are responsible
 * for performing this subtraction before feeding rows into this helper —
 * the canonical reducer is `computeCheckedOutForAsset` in
 * `~/modules/booking/service.server`, which is the single source of truth
 * shared by the OUT-side (`computeBookingAssetRemainingToCheckOut`) and
 * the overview-side. Without that pre-computation, the badge over-reports
 * units as checked-out (the regression tracked as #96).
 *
 * RESERVED rows are unaffected — they carry the raw booked quantity.
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

  // `ba.quantity` for ONGOING/OVERDUE rows is the SERVER-COMPUTED count of
  // units still off the shelf on that booking: what went out minus what came
  // back or was used up (`getAssetQuantityRows`, reading
  // `~/modules/booking/checked-out.server`). This helper trusts that contract
  // and simply sums. A raw `BookingAsset.quantity` fed in here over-reports
  // checked-out units: do the netting at the data source, so this stays pure.
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

  /**
   * Units physically on the shelf right now.
   *
   * DIFFERENT FROM `available` ABOVE, on purpose, and the difference is the
   * whole point: `available` subtracts RESERVED units, so once commitments
   * exceed the pool it goes NEGATIVE, the tooltip footer rendered
   * "-2 free right now", and for a heavily-booked asset whose reservations sum
   * to 500 against a pool of 10 it would read "-490 free right now". There is
   * no such thing as negative free stock.
   *
   * A reserved unit has not left the building; it is claimed for a future date.
   * So this counts only what is genuinely gone, custody and checked-out, and
   * matches the `Free now` column on the assets index, which is derived
   * server-side from the same rule.
   *
   * `available` is deliberately left alone: `getQuantityBadgeLabelAndColor`
   * keys the "Reserved" vs "Partially reserved" label off it, and changing that
   * would move badge labels across every surface in the app, a product
   * decision, not a display fix.
   */
  /**
   * Units earmarked to kits. Subtracted below for the same reason custody is:
   * they are spoken for and cannot be handed to someone else. The assets index
   * passes the SERVER's free-now figure, which already excludes them, so
   * leaving them out here would make the two surfaces disagree the moment an
   * asset belongs to a kit.
   */
  const inKits = assetKits.reduce((sum, ak) => sum + (ak.quantity ?? 0), 0);

  const freeNow =
    typeof asset.freeNow === "number"
      ? Math.max(0, asset.freeNow)
      : Math.max(0, total - inCustody - inKits - checkedOut);

  return {
    total,
    inCustody,
    inKits,
    reserved,
    checkedOut,
    available,
    freeNow,
    bookingAssets,
    assetKits,
    nextReservedFrom: asset.nextReservedFrom ?? null,
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
  const { checkedOut, inCustody, reserved, available, freeNow } = data;

  /**
   * **`freeNow` here, not `available`.**
   *
   * These two branches ask a PHYSICAL question: is there anything left on the
   * shelf, or has it all gone? `available` subtracts future reservations, and a
   * reserved unit has not moved, so mixing it in let a future booking decide
   * how we describe the present.
   *
   * The bug that reached users: a pool of 10 with 5 units out on a booking and
   * 5 reserved for next month drove `available` to zero, so the badge read
   * "Checked out" while five units sat on the shelf. One checkout plus one
   * future booking is all it takes. It also made the badge contradict the
   * `Free now` column on the same row, which correctly said 5.
   *
   * The `reserved` branch below deliberately keeps `available`. Its question,
   * is every unit spoken for at some point, is about commitments, so
   * commitments belong in the number.
   */
  if (checkedOut > 0) {
    return {
      label:
        freeNow <= 0
          ? ASSET_QTY_STATUS_LABELS.CHECKED_OUT
          : ASSET_QTY_STATUS_LABELS.PARTIALLY_CHECKED_OUT,
      colors: BADGE_COLORS.violet,
    };
  }

  if (inCustody > 0) {
    return {
      label:
        freeNow <= 0
          ? ASSET_QTY_STATUS_LABELS.IN_CUSTODY
          : ASSET_QTY_STATUS_LABELS.PARTIAL_CUSTODY,
      colors: BADGE_COLORS.blue,
    };
  }

  if (reserved > 0) {
    return {
      label:
        available <= 0
          ? ASSET_QTY_STATUS_LABELS.RESERVED
          : ASSET_QTY_STATUS_LABELS.PARTIALLY_RESERVED,
      colors: BADGE_COLORS.blue,
    };
  }

  /* Fallback — shouldn't be reached because getQuantityData returns
   * null when all counts are zero, but be defensive */
  return {
    label: ASSET_QTY_STATUS_LABELS.AVAILABLE,
    colors: BADGE_COLORS.green,
  };
}
