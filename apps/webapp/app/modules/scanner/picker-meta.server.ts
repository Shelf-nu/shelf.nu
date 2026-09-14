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
 * @see {@link file://./../asset/availability.server.ts} `getAssetAvailabilityBatch`,
 *   which answers the booking context.
 */

import { AssetType } from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";
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
 * `maxAllowedForThisKit`, a booking's `bookable`) to a uniform `maxAllowed`.
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

  // Booking: the pool comes from `getAssetAvailabilityBatch` — the same
  // primitive the manage-assets picker lists rows by and the write guard
  // (`assertAssetQuantitiesAvailable`) enforces with. The scanner drawer both
  // caps its qty input and refuses a scan on this number, so it has to be the
  // server's number rather than a second derivation of it. Summing the parts
  // here instead gets two of them wrong: kit-driven `BookingAsset` rows are
  // already inside `inKits`, so counting them again subtracts a kit slice
  // twice, and a plain sum stacks bookings that never overlap each other,
  // where the primitive sweeps for the peak concurrent claim. Both understate
  // the pool, which refuses an add the server would have accepted.
  //
  // Without dates the primitive falls back to the conservative sum of every
  // active commitment, so a booking still being planned never over-promises.
  const booking = await db.booking.findUnique({
    where: { id: context.id, organizationId },
    select: { id: true, from: true, to: true },
  });
  if (!booking) return null;

  const availabilityByAsset = await getAssetAvailabilityBatch([assetId], {
    organizationId,
    window:
      booking.from && booking.to
        ? { from: booking.from, to: booking.to }
        : null,
    // This booking's own rows are what the scan is topping up; leaving them in
    // would measure the request against itself.
    excludeBookingId: booking.id,
  });

  return {
    // `bookable` is signed so write guards can tell "already over-committed"
    // from "exactly full". This one bounds a qty input, so clamp it.
    maxAllowed: Math.max(0, availabilityByAsset.get(assetId)?.bookable ?? 0),
    assetQuantity: totalQty,
    unitOfMeasure: asset.unitOfMeasure,
  };
}
