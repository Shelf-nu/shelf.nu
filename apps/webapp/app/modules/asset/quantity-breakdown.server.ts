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
import {
  computeCheckedOutByBookingBatch,
  type AvailabilityBatchClient,
} from "./availability.server";
import { isQuantityTracked } from "./utils";

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
 * One line per active booking, as {@link toStillOutBookingRows} emits it. It
 * stands for the whole booking, so it carries no field of any single slice.
 */
type StillOutBookingRow<Row extends QuantityTooltipBookingRow> = {
  quantity: number;
  assetKitId: null;
  booking: NonNullable<Row["booking"]>;
};

/**
 * Rewrites an asset's booking slices into the rows the quantity tooltip
 * (`getQuantityData`) expects.
 *
 * RESERVED rows pass through. ONGOING / OVERDUE rows collapse to one per
 * booking carrying the units of the asset still off the shelf on it, from
 * {@link computeCheckedOutByBookingForAsset}: what went out minus what came back
 * or was used up. Their `assetKitId` is `null`, because the tooltip lists one
 * line per booking. Each active line is built from the booking alone, so no
 * per-slice field (`id`, `checkedOutAt`, ...) of whichever slice came first can
 * ride along on it. Active bookings with nothing still out are dropped.
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
): Array<Row | StillOutBookingRow<Row>> {
  const reservedRows: Row[] = [];
  const activeBookings = new Map<string, NonNullable<Row["booking"]>>();
  for (const row of rows) {
    const status = row.booking?.status;
    if (status === "ONGOING" || status === "OVERDUE") {
      if (row.booking && !activeBookings.has(row.booking.id)) {
        activeBookings.set(row.booking.id, row.booking);
      }
    } else {
      reservedRows.push(row);
    }
  }

  const activeRows: StillOutBookingRow<Row>[] = [];
  for (const [bookingId, booking] of activeBookings) {
    const stillOut = stillOutByBooking.get(bookingId)?.total ?? 0;
    // Nothing went out yet, or everything that did has come back.
    if (stillOut <= 0) continue;
    activeRows.push({ quantity: stillOut, assetKitId: null, booking });
  }

  return [...reservedRows, ...activeRows];
}

/** One asset row as a list loader ships it: its type and raw booking slices. */
type ListAssetWithBookingRows = {
  id: string;
  type?: string | null;
  // The index include adds `booking` at runtime, but its static row type is
  // the bare pivot, so other fields are allowed through.
  bookingAssets?: Array<{
    booking?: { id: string; status?: string | null } | null;
    [key: string]: unknown;
  }> | null;
};

/**
 * The batched {@link getAssetQuantityRows} for a list surface: for every
 * QUANTITY_TRACKED asset on an ONGOING / OVERDUE booking, one row per active
 * booking carrying the units of it still off the shelf there, in the shape
 * {@link toStillOutBookingRows} emits. A list loader ships these as the asset's
 * `stillOutBookingAssets`, which `getQuantityData` reads in place of
 * `bookingAssets`.
 *
 * List loaders cannot net `bookingAssets` in place: the same rows feed the
 * booking custodian and the availability calendar, which need them per slice,
 * and they hold only the first active booking. So the bookings are read here,
 * all of them, in a fixed number of queries whatever the page size.
 *
 * @param db - Prisma client to read through.
 * @param args.assets - The page's asset rows. QUANTITY_TRACKED ones are read
 *   when they carry an active booking slice, or no `bookingAssets` at all.
 * @param args.organizationId - Caller's organization. Scopes every read.
 * @returns assetId → its active booking rows (empty when nothing is still out).
 *   Assets that were not read are absent.
 */
export async function getStillOutBookingRowsByAsset(
  db: ExtendedPrismaClient,
  {
    assets,
    organizationId,
  }: { assets: ListAssetWithBookingRows[]; organizationId: string }
): Promise<Map<string, StillOutBookingRow<QuantityTooltipBookingRow>[]>> {
  const byAsset = new Map<
    string,
    StillOutBookingRow<QuantityTooltipBookingRow>[]
  >();

  const assetIds = assets
    .filter(
      (asset) =>
        isQuantityTracked(asset) &&
        // Rows that carry booking slices say up front whether the asset is on
        // an active booking. Rows without any (the advanced index) cannot, so
        // they are read and the batch keeps only active bookings.
        (!asset.bookingAssets ||
          asset.bookingAssets.some((row) => {
            const status = row.booking?.status;
            return status === "ONGOING" || status === "OVERDUE";
          }))
    )
    .map((asset) => asset.id);
  if (assetIds.length === 0) return byAsset;

  const stillOutByAsset = await computeCheckedOutByBookingBatch(
    db as unknown as AvailabilityBatchClient,
    assetIds,
    organizationId
  );

  const bookingIds = new Set<string>();
  for (const byBooking of stillOutByAsset.values()) {
    for (const [bookingId, { total }] of byBooking) {
      if (total > 0) bookingIds.add(bookingId);
    }
  }
  const bookings =
    bookingIds.size > 0
      ? await db.booking.findMany({
          where: { id: { in: [...bookingIds] }, organizationId },
          select: { id: true, name: true, status: true },
        })
      : [];
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  for (const assetId of assetIds) {
    const rows: StillOutBookingRow<QuantityTooltipBookingRow>[] = [];
    for (const [bookingId, { total }] of stillOutByAsset.get(assetId) ?? []) {
      const booking = bookingById.get(bookingId);
      // Nothing went out yet, or everything that did has come back.
      if (total <= 0 || !booking) continue;
      rows.push({ quantity: total, assetKitId: null, booking });
    }
    byAsset.set(assetId, rows);
  }

  return byAsset;
}
