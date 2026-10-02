/**
 * Asset Quantity Breakdown (server)
 *
 * Single source of truth for fetching the per-booking + per-kit quantity
 * slices a QUANTITY_TRACKED asset needs, with the effective ONGOING/OVERDUE
 * post-processing already applied. The returned object conforms to the
 * {@link QuantityAwareAsset} contract so callers can feed it straight into
 * `getQuantityData` (the pure reducer in
 * `~/components/assets/asset-status-badge/quantity-data.ts`).
 *
 * The web `/api/assets/$assetId/quantity-breakdown` loader and the mobile
 * asset detail endpoint both read it, and it takes its checked-out figures
 * from `booking/checked-out.server`, so those surfaces and the asset overview
 * report the same units as still out.
 *
 * @see {@link file://./../../routes/api+/assets.$assetId.quantity-breakdown.ts}
 * @see {@link file://./../../routes/api+/mobile+/assets.$assetId.ts}
 * @see {@link file://./../../components/assets/asset-status-badge/quantity-data.ts}
 */

import type { ExtendedPrismaClient } from "~/database/db.server";
import { computeCheckedOutByBookingForAsset } from "~/modules/booking/checked-out.server";
import { ShelfError } from "~/utils/error";

/** Arguments for {@link getAssetQuantityRows}. */
type GetAssetQuantityRowsArgs = {
  /** The asset to fetch quantity slices for. */
  assetId: string;
  /** Org the caller is scoped to — enforces multi-tenant isolation. */
  organizationId: string;
};

/**
 * Fetches the quantity-breakdown slices for a single asset and applies the
 * effective-quantity post-processing for ONGOING/OVERDUE bookings.
 *
 * The raw `BookingAsset.quantity` is the BOOKED quantity. On an ONGOING /
 * OVERDUE booking that overstates what is off the shelf: units may not have
 * gone out yet, and units may have come back or been used up. Per the
 * `getQuantityData` contract, active rows MUST ship the units still out, which
 * come from {@link computeCheckedOutByBookingForAsset}, the same figures the
 * asset overview's "Checked out" tile sums. RESERVED rows pass through
 * unchanged.
 *
 * Active rows are collapsed to one per booking, because the tooltip groups by
 * booking. The per-slice `assetKitId` is set to `null` on them. Active bookings
 * with nothing still out are dropped.
 *
 * @param db - Prisma client (or transaction) to read through.
 * @param args - The org-scoped asset to fetch (see {@link GetAssetQuantityRowsArgs}).
 * @returns The asset row with `bookingAssets` rewritten to
 *   `[...reservedRows, ...effectiveActiveRows]`.
 * @throws {ShelfError} 404 when the asset is not found in the caller's org.
 */
export async function getAssetQuantityRows(
  db: ExtendedPrismaClient,
  { assetId, organizationId }: GetAssetQuantityRowsArgs
) {
  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId },
    select: {
      id: true,
      type: true,
      quantity: true,
      custody: { select: { quantity: true } },
      bookingAssets: {
        where: {
          booking: { status: { in: ["RESERVED", "ONGOING", "OVERDUE"] } },
        },
        select: {
          quantity: true,
          assetKitId: true,
          booking: { select: { id: true, name: true, status: true } },
        },
      },
      assetKits: {
        select: {
          id: true,
          quantity: true,
          kit: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!asset) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: "Asset not found",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const stillOutByBooking = await computeCheckedOutByBookingForAsset(
    db,
    asset.id,
    organizationId
  );

  return {
    ...asset,
    bookingAssets: toStillOutBookingRows(
      asset.bookingAssets,
      stillOutByBooking
    ),
  };
}

/** The booking-slice fields {@link toStillOutBookingRows} reads. */
type QuantityTooltipBookingRow = {
  quantity: number;
  assetKitId: string | null;
  booking: { id: string; status: string } | null;
};

/**
 * Rewrites an asset's booking slices into the rows the quantity tooltip
 * (`getQuantityData`) expects.
 *
 * RESERVED rows pass through. ONGOING / OVERDUE rows collapse to one per
 * booking carrying the units of the asset still off the shelf on it, from
 * {@link computeCheckedOutByBookingForAsset}: what went out minus what came back
 * or was used up. Their `assetKitId` is `null`, because the tooltip lists one
 * line per booking. Active bookings with nothing still out are dropped.
 *
 * Every loader that feeds the tooltip goes through this, so the tooltip and
 * the asset overview's "Checked out" figure cannot disagree.
 *
 * @param rows - The asset's RESERVED / ONGOING / OVERDUE booking slices.
 * @param stillOutByBooking - Output of {@link computeCheckedOutByBookingForAsset}.
 * @returns RESERVED rows first, then one row per active booking with units out.
 */
export function toStillOutBookingRows<Row extends QuantityTooltipBookingRow>(
  rows: Row[],
  stillOutByBooking: Map<string, { total: number }>
): Row[] {
  const reservedRows: Row[] = [];
  const firstActiveRowByBooking = new Map<string, Row>();
  for (const row of rows) {
    const status = row.booking?.status;
    if (status === "ONGOING" || status === "OVERDUE") {
      if (row.booking && !firstActiveRowByBooking.has(row.booking.id)) {
        firstActiveRowByBooking.set(row.booking.id, row);
      }
    } else {
      reservedRows.push(row);
    }
  }

  const activeRows: Row[] = [];
  for (const [bookingId, row] of firstActiveRowByBooking) {
    const stillOut = stillOutByBooking.get(bookingId)?.total ?? 0;
    // Nothing went out yet, or everything that did has come back.
    if (stillOut <= 0) continue;
    activeRows.push({ ...row, quantity: stillOut, assetKitId: null });
  }

  return [...reservedRows, ...activeRows];
}
