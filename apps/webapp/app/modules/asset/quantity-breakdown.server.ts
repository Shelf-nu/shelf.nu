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
          // `from` lets the tooltip say WHEN, which is the fact that reconciles
          // "12 reserved" with "10 free right now", those units have not left
          // the shelf yet. Without it the two lines read as a contradiction.
          booking: {
            select: { id: true, name: true, status: true, from: true },
          },
        },
        // Soonest first. The tooltip renders only the first few slices for a
        // heavily-booked asset, so the order decides WHICH ones survive the
        // cut, and the booking starting next is the one worth showing.
        orderBy: { booking: { from: "asc" } },
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

  type BookingAssetRow = (typeof asset.bookingAssets)[number];

  // Split the booking slices into RESERVED (pass-through) and active
  // (ONGOING/OVERDUE, which carry the units still out instead).
  const reservedRows: BookingAssetRow[] = [];
  const activeRows: BookingAssetRow[] = [];
  for (const ba of asset.bookingAssets) {
    const status = ba.booking?.status;
    if (status === "ONGOING" || status === "OVERDUE") {
      activeRows.push(ba);
    } else {
      reservedRows.push(ba);
    }
  }

  // One row per active booking, carrying the units still out on it.
  const stillOutByBooking = await computeCheckedOutByBookingForAsset(
    db,
    asset.id,
    organizationId
  );
  const activeBookings = new Map<
    string,
    NonNullable<BookingAssetRow["booking"]>
  >();
  for (const ba of activeRows) {
    if (ba.booking) activeBookings.set(ba.booking.id, ba.booking);
  }
  const effectiveActiveRows: BookingAssetRow[] = Array.from(
    activeBookings.values()
  ).map((booking) => ({
    quantity: stillOutByBooking.get(booking.id)?.total ?? 0,
    // Per-slice attribution collapses at the booking grain: surface as
    // standalone (`null`) so the tooltip renders one line per booking.
    assetKitId: null,
    booking,
  }));

  // Drop active bookings with nothing still out: nothing went out yet, or
  // everything that did has come back.
  const cleanedActiveRows = effectiveActiveRows.filter(
    (row) => (row.quantity ?? 0) > 0
  );

  return {
    ...asset,
    bookingAssets: [...reservedRows, ...cleanedActiveRows],
  };
}
