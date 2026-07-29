/**
 * Per-scan strict-available pool computation for the QR-scanner
 * drawers (location, kit, booking).
 *
 * Each scanner drawer wants the same "· X available" / "qty input
 * MAX" UX the manage-assets picker shows. The picker computes this
 * via dedicated per-context helpers; this module wraps the three so
 * the scanner can dispatch by a single `pickerContext` query param.
 *
 * Returns `null` for INDIVIDUAL assets — the drawers don't render a
 * qty input or an "available" annotation for them.
 *
 * @see {@link file://./../location/picker-meta.server.ts} `getLocationPickerMeta`
 * @see {@link file://./../kit/picker-meta.server.ts} `getKitPickerMeta`
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx}
 *   booking picker's inline availability formula (Phase 4b)
 */

import { AssetType } from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getBookingPoolAvailability } from "~/modules/asset/availability.server";
import { getKitPickerMeta } from "~/modules/kit/picker-meta.server";
import { getLocationPickerMeta } from "~/modules/location/picker-meta.server";

/** Identifies which destination the scanner is feeding. */
export const ScannerPickerContextSchema = z.object({
  type: z.enum(["location", "kit", "booking"]),
  id: z.string().min(1),
});

export type ScannerPickerContext = z.infer<typeof ScannerPickerContextSchema>;

/**
 * Normalised picker-meta shape returned to scanner drawers. Mirrors
 * the fields each manage-assets picker exposes on a per-row basis but
 * collapses the context-specific names (`maxAllowedForThisLocation`,
 * `maxAllowedForThisKit`, ad-hoc booking math) to a uniform `maxAllowed`.
 */
export type ScannerPickerMeta = {
  /** Strict-available pool the qty input is bounded by. */
  maxAllowed: number;
  /** Asset's total quantity — shown alongside MAX in the row label. */
  assetQuantity: number;
  unitOfMeasure: string | null;
};

/**
 * Returns picker meta for a single qty-tracked asset in the given
 * destination, or `null` for INDIVIDUAL assets / when the asset
 * cannot be found in scope.
 */
export async function getScannerPickerMeta({
  assetId,
  organizationId,
  context,
}: {
  assetId: string;
  organizationId: string;
  context: ScannerPickerContext;
}): Promise<ScannerPickerMeta | null> {
  // Fast-fail on INDIVIDUAL — the qty input never renders, no point
  // computing a strict-available pool.
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId },
    select: { id: true, type: true, quantity: true, unitOfMeasure: true },
  });
  if (!asset || asset.type !== AssetType.QUANTITY_TRACKED) return null;

  const totalQty = asset.quantity ?? 0;

  if (context.type === "location") {
    const metaMap = await getLocationPickerMeta({
      locationId: context.id,
      organizationId,
      assetIds: [assetId],
    });
    const meta = metaMap.get(assetId);
    if (!meta) return null;
    return {
      maxAllowed: meta.maxAllowedForThisLocation,
      assetQuantity: totalQty,
      unitOfMeasure: meta.unitOfMeasure,
    };
  }

  if (context.type === "kit") {
    const metaMap = await getKitPickerMeta({
      kitId: context.id,
      organizationId,
      assetIds: [assetId],
    });
    const meta = metaMap.get(assetId);
    if (!meta) return null;
    return {
      maxAllowed: meta.maxAllowedForThisKit,
      assetQuantity: totalQty,
      unitOfMeasure: meta.unitOfMeasure,
    };
  }

  // Booking: single-asset call of the canonical booking-pool module with
  // the SAME named flag set as the manage-assets picker — the header
  // comment of this file demands parity with the picker, and sharing
  // `getBookingPoolAvailability` makes that parity structural instead of
  // copy-paste discipline:
  //   custodyScope "all"      — every custody row subtracts
  //   includeKitSlices true   — kit-committed units subtract (multi-kit
  //                             qty-tracked rows can still be added to a
  //                             booking from their free pool)
  //   window when both dates  — the "overlapping" filter only fires when
  //                             the booking has dates; dateless bookings
  //                             compete with every reservation (#2724
  //                             divergence preserved)
  //   dispositionAware false  — raw booked sums, pre-migration behavior
  //   excludeBookingId        — this booking's own reservation doesn't
  //                             count against itself
  const booking = await db.booking.findUnique({
    where: { id: context.id, organizationId },
    select: { id: true, from: true, to: true },
  });
  if (!booking) return null;

  const poolMap = await getBookingPoolAvailability({
    assetIds: [assetId],
    organizationId,
    excludeBookingId: booking.id,
    window:
      booking.from && booking.to
        ? { from: booking.from, to: booking.to }
        : null,
    custodyScope: "all",
    includeKitSlices: true,
    dispositionAware: false,
  });

  // `.available` (clamped) — the qty input MAX can't be negative.
  const maxAllowed = poolMap.get(assetId)?.available ?? 0;

  return {
    maxAllowed,
    assetQuantity: totalQty,
    unitOfMeasure: asset.unitOfMeasure,
  };
}
