/**
 * Booking sources: whether a booking row's Location cell shows the slice's
 * sources.
 *
 * Pure and client-safe (no server imports), so the web booking page (loader
 * and component), the booking PDF and the mobile booking payload all decide
 * the same way which rows show sources and which keep the ordinary Location
 * cell.
 *
 * @see {@link file://./../../../components/booking/booking-source-cell.tsx} the cell that renders the result
 * @see {@link file://./../pdf-helpers.ts} the PDF rows
 * @see {@link file://./../../../routes/api+/mobile+/bookings.$bookingId.ts} the phone payload
 */

import type { BookingSourcePart } from "@shelf/quantity-control";
import type { SourceAllocationMode } from "./types";

/** What the Location cell renders for one pool slice. */
export type PoolSourceCell = {
  /** Display parts, ordered by location name, then the non-location kinds. */
  parts: BookingSourcePart[];
};

/**
 * Whether a booking slice is a standalone pool slice: a quantity-tracked
 * asset with no live kit (`assetKitId` null). `sourceKitId` is provenance
 * only, so units left behind when an asset leaves a kit count as standalone.
 *
 * @param slice - The booking slice with its asset's type
 * @returns True when the slice's Location cell may show its sources
 */
export function isStandalonePoolSlice(slice: {
  asset: { type: string };
  assetKitId: string | null;
}): boolean {
  return slice.asset.type === "QUANTITY_TRACKED" && !slice.assetKitId;
}

/**
 * Decides whether a slice's Location cell shows its sources.
 *
 * Only standalone pool slices (quantity-tracked and not kit-driven, which
 * includes units left behind when an asset leaves a kit) allocated by source
 * (`AUTO` or `MANUAL`) with something to show qualify. A pool without manual
 * placements keeps the ordinary cell while all its units come from Unplaced:
 * every unit of such a pool is unplaced, so the sources would say nothing
 * new. Individual assets, kit rows and `LEGACY` slices never reach this cell.
 *
 * @param args.summary - The slice's source summary from the loader, if any
 * @param args.isStandalonePoolSlice - Output of {@link isStandalonePoolSlice}
 * @param args.hasManualPlacements - The pool has at least one non-kit placement
 * @returns The cell to render, or `null` to keep the ordinary Location cell
 */
export function selectPoolSourceCell(args: {
  summary:
    | { parts: BookingSourcePart[]; mode: SourceAllocationMode }
    | undefined;
  isStandalonePoolSlice: boolean;
  hasManualPlacements: boolean;
}): PoolSourceCell | null {
  const { summary, isStandalonePoolSlice, hasManualPlacements } = args;
  if (!summary || !isStandalonePoolSlice) return null;
  if (summary.mode !== "AUTO" && summary.mode !== "MANUAL") return null;
  if (summary.parts.length === 0) return null;
  if (
    !hasManualPlacements &&
    summary.parts.every((part) => part.kind === "UNPLACED")
  ) {
    return null;
  }
  return { parts: summary.parts };
}
