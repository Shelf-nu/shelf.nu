/**
 * The "from <Location>" line under a checked-out `LEGACY` pool slice on the
 * booking page.
 *
 * A `LEGACY` slice (one not planned by source) records the location its units
 * left from at check-out in `BookingAsset.sourceLocationId`. The booking row
 * says so under the title ("from Studio"), so the operator sees where the
 * units went out from, and check-in takes used-up units off that same
 * location. The line shows only when:
 *
 * - the slice is a standalone slice of a quantity-tracked pool whose units
 *   came from a manual placement (see `isManualSourceSlice`: kit slices and
 *   detached kit residue record the kit's location, never a placement);
 * - the slice is `LEGACY`: a slice planned by source (`AUTO` / `MANUAL`)
 *   shows its sources in the Location cell instead, and never both;
 * - the pool sits at two or more manual placements: with one placement, or
 *   none, the line would say nothing new.
 *
 * The location names are read only when some slice qualifies, so a booking
 * without a checked-out `LEGACY` pool slice costs no query.
 *
 * @see {@link file://./../routes/_layout+/bookings.$bookingId.overview.tsx} the loader
 * @see {@link file://./../components/booking/list-asset-content.tsx} the row
 */

import type { BookingSourceAllocation } from "@prisma/client";
import { isManualSourceSlice } from "~/modules/booking/checkout-source-location";
import {
  loadSliceSourceLocations,
  type SliceSourceLocation,
} from "~/modules/booking/checkout-source-location.server";

/** The slice fields the from-line reads. */
export type LegacySourceLineSlice = {
  id: string;
  assetId: string;
  asset: { type: string };
  assetKitId: string | null;
  sourceKitId: string | null;
  sourceLocationId: string | null;
  sourceAllocation: BookingSourceAllocation;
};

/**
 * Whether a slice may show the "from <Location>" line: a standalone pool
 * slice, not planned by source, whose units left from a manual placement.
 * Whether its pool is multi-placed is judged later, from the asset rows.
 *
 * @param slice - One booking slice
 * @returns True when the slice qualifies
 */
export function isLegacySourceLineSlice(slice: LegacySourceLineSlice): boolean {
  return (
    slice.asset.type === "QUANTITY_TRACKED" &&
    slice.sourceAllocation === "LEGACY" &&
    isManualSourceSlice(slice)
  );
}

/**
 * Reads the names of the locations qualifying slices left from, in one
 * org-scoped query. Sends no query when no slice qualifies.
 *
 * @param args.organizationId - Scopes the read
 * @param args.bookingAssets - Every slice of the booking
 * @returns Location id to `{ id, name }`; empty when no slice qualifies
 */
export function loadLegacySourceLocations({
  organizationId,
  bookingAssets,
}: {
  organizationId: string;
  bookingAssets: LegacySourceLineSlice[];
}): Promise<Map<string, SliceSourceLocation>> {
  const locationIds = bookingAssets
    .filter(isLegacySourceLineSlice)
    .map((slice) => slice.sourceLocationId);
  if (locationIds.length === 0) return Promise.resolve(new Map());
  return loadSliceSourceLocations({ organizationId, locationIds });
}

/**
 * The "from <Location>" line per slice, keyed by `bookingAssetId`.
 *
 * @param args.bookingAssets - Every slice of the booking
 * @param args.sourceLocationsById - Output of {@link loadLegacySourceLocations}
 * @param args.manualPlacementCount - Non-kit placements of an asset
 * @param args.hasSourceCell - True for a slice whose Location cell shows its
 *   sources; such a slice never also gets the line
 * @returns The location to name per qualifying slice; slices without a line
 *   are absent
 */
export function legacySourceLocationsBySlice({
  bookingAssets,
  sourceLocationsById,
  manualPlacementCount,
  hasSourceCell,
}: {
  bookingAssets: LegacySourceLineSlice[];
  sourceLocationsById: Map<string, SliceSourceLocation>;
  manualPlacementCount: (assetId: string) => number;
  hasSourceCell: (bookingAssetId: string) => boolean;
}): Record<string, SliceSourceLocation> {
  const bySlice: Record<string, SliceSourceLocation> = {};
  if (sourceLocationsById.size === 0) return bySlice;
  for (const slice of bookingAssets) {
    if (!isLegacySourceLineSlice(slice) || !slice.sourceLocationId) continue;
    if (hasSourceCell(slice.id)) continue;
    if (manualPlacementCount(slice.assetId) < 2) continue;
    const location = sourceLocationsById.get(slice.sourceLocationId);
    if (location) bySlice[slice.id] = location;
  }
  return bySlice;
}
