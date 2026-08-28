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
 * Extracted from the inline logic that previously lived in the web
 * `/api/assets/$assetId/quantity-breakdown` loader so the web tooltip path
 * and the mobile asset detail endpoint share ONE implementation and can't
 * drift on the effective-checked-out math (regression #96).
 *
 * @see {@link file://./../../routes/api+/assets.$assetId.quantity-breakdown.ts}
 * @see {@link file://./../../routes/api+/mobile+/assets.$assetId.ts}
 * @see {@link file://./../../components/assets/asset-status-badge/quantity-data.ts}
 */

import type { ExtendedPrismaClient } from "~/database/db.server";
import { computeBookingAssetRemainingToCheckOut } from "~/modules/booking/service.server";
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
 * The raw `BookingAsset.quantity` is the BOOKED quantity (the snapshot the
 * user reserved at booking time). On the OUT-flow, units can be scanned out
 * progressively via `PartialBookingCheckout`, so the BOOKED total may overstate
 * what's actually checked out at any given moment. Per the `getQuantityData`
 * contract, ONGOING/OVERDUE rows MUST ship the server-computed EFFECTIVE count
 * (booked − remaining-to-check-out); RESERVED rows pass through unchanged.
 *
 * We aggregate active rows per `bookingId` (one row per booking) — the tooltip
 * groups by booking and `computeBookingAssetRemainingToCheckOut` operates per
 * (bookingId, assetId), so per-booking is the correct grain. The per-slice
 * `assetKitId` discriminator is intentionally dropped (set to `null`) on the
 * aggregated active rows; the per-booking summation doesn't need it. Active
 * rows with zero effective quantity are dropped (nothing scanned out yet).
 *
 * @param db - Prisma client (or transaction) to read through.
 * @param args - The org-scoped asset to fetch (see {@link GetAssetQuantityRowsArgs}).
 * @returns The asset row with `bookingAssets` rewritten to
 *   `[...reservedRows, ...effectiveActiveRows]` — the same shape the web
 *   quantity-breakdown loader previously emitted.
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

  type BookingAssetRow = (typeof asset.bookingAssets)[number];

  // Split the booking slices into RESERVED (pass-through) and active
  // (ONGOING/OVERDUE, which need the effective-checked-out subtraction).
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

  // Aggregate active rows by bookingId so we call the canonical reducer once
  // per booking — multiple slices of the same asset on the same booking
  // (kit-driven + standalone) share a booking-level claim pool.
  type ActiveBookingAggregate = {
    booking: NonNullable<BookingAssetRow["booking"]>;
    bookedQuantity: number;
  };
  const activeByBooking = new Map<string, ActiveBookingAggregate>();
  for (const ba of activeRows) {
    const bookingId = ba.booking?.id;
    if (!bookingId) continue;
    const existing = activeByBooking.get(bookingId);
    if (existing) {
      existing.bookedQuantity += ba.quantity ?? 0;
    } else {
      activeByBooking.set(bookingId, {
        booking: ba.booking,
        bookedQuantity: ba.quantity ?? 0,
      });
    }
  }

  // Run each booking through `computeBookingAssetRemainingToCheckOut` in
  // parallel — independent reads, no shared state.
  const effectiveActiveRows: BookingAssetRow[] = await Promise.all(
    Array.from(activeByBooking.entries()).map(async ([bookingId, agg]) => {
      const remaining = await computeBookingAssetRemainingToCheckOut(
        db,
        bookingId,
        asset.id
      );
      // effective claimed = booked − remaining-to-check-out, floored at 0
      const effectiveQuantity = Math.max(0, agg.bookedQuantity - remaining);
      return {
        quantity: effectiveQuantity,
        // Per-slice attribution collapses at the aggregate grain — surface as
        // standalone (`null`) so the tooltip renders one line per booking.
        assetKitId: null,
        booking: agg.booking,
      };
    })
  );

  // Drop ONGOING/OVERDUE rows with zero effective quantity — they represent
  // bookings where nothing has been scanned out yet.
  const cleanedActiveRows = effectiveActiveRows.filter(
    (row) => (row.quantity ?? 0) > 0
  );

  return {
    ...asset,
    bookingAssets: [...reservedRows, ...cleanedActiveRows],
  };
}
