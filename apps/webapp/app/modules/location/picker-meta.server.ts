/**
 * Location Manage-Assets Picker Metadata
 *
 * Computes the per-asset `PickerAssetMeta` payload consumed by the
 * location manage-assets picker (`/locations/$locationId/assets/manage-assets`).
 * The picker shows a qty input alongside QUANTITY_TRACKED rows, bounded
 * by the strict-available pool of units that may be placed at this
 * location.
 *
 * Mirrors {@link file://./../kit/picker-meta.server.ts} structurally but
 * uses the **orthogonal placement model** for the MAX formula: location
 * is a physical-whereabouts axis that does NOT subtract custody or
 * bookings. A pen at Office 1 can simultaneously be in Alice's custody
 * and reserved for a booking — each axis carries its own
 * `sum ≤ Asset.quantity` invariant independently.
 *
 * See PRD design principle #3 in
 * `docs/proposals/quantitative-assets.md` for the rationale
 * ("orthogonal placement axes" — each pivot's `sum ≤ Asset.quantity`
 * invariant holds independently of the others).
 *
 * @see {@link file://./../../routes/_layout+/locations.$locationId.assets.manage-assets.tsx}
 * @see {@link file://./service.server.ts} — `updateLocationAssets` re-validates with the same formula
 */

import { AssetType } from "@prisma/client";

import { db } from "~/database/db.server";

/**
 * Per-asset picker metadata for QUANTITY_TRACKED rows.
 *
 * Drives the qty input's MAX and surfaces the "also at Location X (N)"
 * indicator when the same qty-tracked asset is already placed
 * elsewhere. INDIVIDUAL rows skip this entirely — they don't render a
 * qty input.
 */
export type PickerAssetMeta = {
  /** `Asset.quantity` — the total pool the asset's units share. */
  assetQuantity: number;
  /** `AssetLocation.quantity` for THIS location (0 if the asset isn't placed here yet). */
  currentAtThisLocation: number;
  /** AssetLocation rows for locations other than this one — for the "also at" indicator. */
  inOtherLocations: {
    locationId: string;
    locationName: string;
    quantity: number;
  }[];
  /**
   * Strict-available pool — the upper bound on units that may be placed
   * at this location. Equals `max(currentAtThisLocation, spaceWithoutMe)`
   * so the user can keep their existing slice in the overcommitted edge
   * case (the sum could exceed Asset.quantity transiently if the data
   * model ever allows it; defensive against that).
   */
  maxAllowedForThisLocation: number;
  /** Unit of measure label (passed through for the qty input suffix). */
  unitOfMeasure: string | null;
};

/**
 * Fetches and computes `PickerAssetMeta` for every QUANTITY_TRACKED
 * asset in `assetIds`. INDIVIDUAL ids are silently ignored.
 *
 * **Orthogonal MAX formula** (intentional deviation from
 * `getKitPickerMeta`):
 *
 *     spaceWithoutMe = Asset.quantity − sum(other locations' AssetLocation.quantity)
 *     max            = max(currentAtThisLocation, spaceWithoutMe)
 *
 * No custody or booking subtraction — location is the placement axis,
 * not the responsibility/reservation axis. A pen at Office 1 stays at
 * Office 1 even while Alice has custody of it.
 *
 * Two subtleties carried over from the kit helper:
 *
 *   1. `max(currentAtThisLocation, spaceWithoutMe)` (not just
 *      spaceWithoutMe) lets the user keep or reduce an over-committed
 *      slice. The DEFERRED constraint trigger
 *      `enforce_asset_location_sum_within_total` should prevent that
 *      state in normal operation, but the picker shouldn't lock the
 *      user out if it's reached.
 *
 *   2. We re-fetch the assets here even though the route loader
 *      already pulls them via `getPaginatedAndFilterableAssets`. The
 *      view-style payload that helper returns doesn't carry the
 *      relation we need (`assetLocations[].location`), and hydrating
 *      it would mean threading that into the shared list view used
 *      everywhere. Cheaper to do a second narrow fetch scoped to the
 *      qty-tracked rows on this page.
 *
 * @param locationId     The location whose picker is being rendered.
 * @param organizationId The acting org — scopes the fetch.
 * @param assetIds       Asset ids visible on the current picker page. Mixed
 *                       types ok; the helper filters INDIVIDUAL out itself.
 * @returns              A `Map<assetId, PickerAssetMeta>` covering only the
 *                       QUANTITY_TRACKED ids. Callers should treat a missing
 *                       entry as "render no qty input for this row".
 */
export async function getLocationPickerMeta({
  locationId,
  organizationId,
  assetIds,
}: {
  locationId: string;
  organizationId: string;
  assetIds: string[];
}): Promise<Map<string, PickerAssetMeta>> {
  if (assetIds.length === 0) return new Map();

  const rows = await db.asset.findMany({
    where: {
      id: { in: assetIds },
      organizationId,
      type: AssetType.QUANTITY_TRACKED,
    },
    select: {
      id: true,
      quantity: true,
      unitOfMeasure: true,
      assetLocations: {
        select: {
          locationId: true,
          quantity: true,
          // Polish-4: discriminate manual vs kit-driven so the picker
          // MAX excludes kit-driven slices from `currentAtThisLocation`
          // (the picker only edits manual rows) but still counts them
          // against the available pool elsewhere.
          assetKitId: true,
          location: { select: { id: true, name: true } },
        },
      },
    },
  });

  return new Map(
    rows.map((row) => {
      const totalQty = row.quantity ?? 0;
      const otherLocations = row.assetLocations.filter(
        (al) => al.locationId !== locationId
      );
      // The picker only edits the MANUAL row at this location.
      // Kit-driven rows at this location stay read-only and their
      // quantity counts against what the manual row can grow to.
      // `== null` / `!= null` (loose equality) covers both `null` and
      // `undefined` — fixtures may omit `assetKitId` entirely and we
      // want them to read as manual placements.
      const manualAtThisLocation = row.assetLocations.find(
        (al) => al.locationId === locationId && al.assetKitId == null
      );
      const kitDrivenAtThisLocation = row.assetLocations
        .filter((al) => al.locationId === locationId && al.assetKitId != null)
        .reduce((sum, al) => sum + (al.quantity ?? 0), 0);
      const otherLocationsQty = otherLocations.reduce(
        (sum, al) => sum + (al.quantity ?? 0),
        0
      );
      const currentAtThisLocation = manualAtThisLocation?.quantity ?? 0;
      // `spaceWithoutMe` excludes ALL rows elsewhere AND the kit-driven
      // rows at THIS location — both eat into the asset's pool that the
      // manual row at this location can claim.
      const spaceWithoutMe = Math.max(
        0,
        totalQty - otherLocationsQty - kitDrivenAtThisLocation
      );
      const maxAllowedForThisLocation = Math.max(
        currentAtThisLocation,
        spaceWithoutMe
      );

      const meta: PickerAssetMeta = {
        assetQuantity: totalQty,
        currentAtThisLocation,
        inOtherLocations: otherLocations.map((al) => ({
          locationId: al.location.id,
          locationName: al.location.name,
          quantity: al.quantity,
        })),
        maxAllowedForThisLocation,
        unitOfMeasure: row.unitOfMeasure,
      };
      return [row.id, meta];
    })
  );
}
