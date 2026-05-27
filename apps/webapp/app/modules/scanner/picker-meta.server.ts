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

import { AssetType, BookingStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
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

  // Booking: matches the asset overview's "Available" formula so the
  // scanner MAX agrees with what the user sees on the asset page:
  //
  //   maxAllowed = Asset.quantity
  //              − sum(AssetKit.quantity)                ← kit-committed
  //              − sum(Custody.quantity)                  ← held by custodians
  //              − sum(BookingAsset.quantity from overlapping
  //                    active bookings, excluding this booking)
  //
  // The booking picker's inline formula (`bookings.$bookingId.
  // overview.manage-assets.tsx:264`) drops the kit term because it
  // pre-filters qty-tracked assets with any kit membership out of the
  // results entirely — that's a separate bug for the picker, but the
  // scanner needs the full formula so multi-kit qty-tracked rows can
  // still be added to a booking from their free pool.
  //
  // The "overlapping" filter only fires when the booking has dates.
  // Bookings without dates compete with every other reservation.
  const booking = await db.booking.findUnique({
    where: { id: context.id, organizationId },
    select: { id: true, from: true, to: true },
  });
  if (!booking) return null;

  const [assetKitSum, custodySum, bookingSum] = await Promise.all([
    db.assetKit.aggregate({
      where: { assetId, organizationId },
      _sum: { quantity: true },
    }),
    db.custody.aggregate({
      where: { assetId },
      _sum: { quantity: true },
    }),
    db.bookingAsset.aggregate({
      where: {
        assetId,
        bookingId: { not: booking.id },
        booking: {
          status: {
            in: [
              BookingStatus.RESERVED,
              BookingStatus.ONGOING,
              BookingStatus.OVERDUE,
            ],
          },
          ...(booking.from &&
            booking.to && {
              OR: [
                { from: { lte: booking.to }, to: { gte: booking.from } },
                { from: { gte: booking.from }, to: { lte: booking.to } },
              ],
            }),
        },
      },
      _sum: { quantity: true },
    }),
  ]);

  const inKits = assetKitSum._sum.quantity ?? 0;
  const inCustody = custodySum._sum.quantity ?? 0;
  const reserved = bookingSum._sum.quantity ?? 0;
  const maxAllowed = Math.max(0, totalQty - inKits - inCustody - reserved);

  return {
    maxAllowed,
    assetQuantity: totalQty,
    unitOfMeasure: asset.unitOfMeasure,
  };
}
