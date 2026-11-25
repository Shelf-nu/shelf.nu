/**
 * Where a pool's reserved bookings take their units from, for the asset page
 * quantity tooltip (read-only: no lock, no conversion).
 *
 * Each RESERVED booking with planned sources gets one line in the booking's
 * own words ("Demo Warehouse 8 · Unplaced 7"), built by the shared display
 * helpers. LEGACY slices have no sources, and kit slices keep their kit line,
 * so neither gets a line.
 *
 * @see {@link file://../../../components/assets/asset-status-badge/quantity-tooltip-content.tsx}
 */

import {
  describeBookingSources,
  formatSourceSummary,
} from "@shelf/quantity-control";

import type { ExtendedPrismaClient } from "~/database/db.server";

/** The client this module reads through. */
type SummaryClient = Pick<
  ExtendedPrismaClient,
  "bookingAsset" | "bookingAssetSource" | "location"
>;

/**
 * The source line of each listed booking's standalone slice of a pool.
 *
 * Queries: the pool's converted standalone slices on those bookings (one;
 * nothing more while every group is LEGACY), then their rows (one) and the
 * names of the locations they name (one, only when a row names one).
 *
 * @param client - `db` or a transaction
 * @param args.organizationId - Scopes every read
 * @param args.assetId - The pool
 * @param args.bookingIds - The RESERVED bookings to describe
 * @returns Booking id to its line; bookings without planned sources are absent
 */
export async function loadReservedSourceSummaries(
  client: SummaryClient,
  {
    organizationId,
    assetId,
    bookingIds,
  }: { organizationId: string; assetId: string; bookingIds: string[] }
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = [...new Set(bookingIds)];
  if (ids.length === 0) return result;

  const slices = await client.bookingAsset.findMany({
    where: {
      assetId,
      bookingId: { in: ids },
      assetKitId: null,
      sourceAllocation: { in: ["AUTO", "MANUAL"] },
      booking: { organizationId, status: "RESERVED" },
    },
    select: { id: true, bookingId: true },
  });
  if (slices.length === 0) return result;

  const rows = await client.bookingAssetSource.findMany({
    where: {
      organizationId,
      bookingAssetId: { in: slices.map((slice) => slice.id) },
    },
    select: {
      bookingAssetId: true,
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });
  const locationIds = [
    ...new Set(rows.flatMap((row) => (row.locationId ? [row.locationId] : []))),
  ];
  const locations =
    locationIds.length === 0
      ? []
      : await client.location.findMany({
          where: { id: { in: locationIds }, organizationId },
          select: { id: true, name: true },
        });
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));

  const bookingBySlice = new Map(slices.map((s) => [s.id, s.bookingId]));
  for (const bookingId of ids) {
    const summary = formatSourceSummary(
      describeBookingSources({
        rows: rows.filter(
          (row) => bookingBySlice.get(row.bookingAssetId) === bookingId
        ),
        locationNames,
        shortSourceKeys: new Set(),
      })
    );
    if (summary) result.set(bookingId, summary);
  }
  return result;
}

/** A tooltip booking row, as the quantity breakdown ships it. */
type TooltipRow = {
  assetKitId: string | null;
  booking: { id: string; status: string } | null;
};

/**
 * Adds `sourceSummary` to the RESERVED standalone rows of a pool whose
 * booking has planned sources, reading them in the queries
 * {@link loadReservedSourceSummaries} makes. Other rows pass through as they
 * are.
 *
 * @param client - `db` or a transaction
 * @param args.organizationId - Scopes every read
 * @param args.assetId - The pool
 * @param args.rows - The tooltip's booking rows
 * @returns The same rows; a reserved standalone one with planned sources
 *   carries `sourceSummary`
 */
export async function withReservedSourceSummaries<Row extends TooltipRow>(
  client: SummaryClient,
  {
    organizationId,
    assetId,
    rows,
  }: { organizationId: string; assetId: string; rows: Row[] }
): Promise<Array<Row | (Row & { sourceSummary: string })>> {
  const isReservedStandalone = (row: Row) =>
    !row.assetKitId && row.booking?.status === "RESERVED";
  const bookingIds = rows.flatMap((row) =>
    isReservedStandalone(row) && row.booking ? [row.booking.id] : []
  );
  const summaries = await loadReservedSourceSummaries(client, {
    organizationId,
    assetId,
    bookingIds,
  });
  if (summaries.size === 0) return rows;
  return rows.map((row) => {
    const summary =
      isReservedStandalone(row) && row.booking
        ? summaries.get(row.booking.id)
        : undefined;
    return summary ? { ...row, sourceSummary: summary } : row;
  });
}
