/**
 * Slice-to-kit attribution
 *
 * The single rule for "which kits does this `BookingAsset` row hold". Marking a
 * kit checked out, releasing it, and naming who holds it all read this rule, so
 * a kit is never out under one reading and unheld under another.
 *
 * Pure and dependency-free so both the booking and the kit services can import
 * it without importing each other.
 *
 * @see {@link file://./service.server.ts} `getKitIdsBySlice` (acquire/release)
 * @see {@link file://./../kit/service.server.ts} the custodian lookups
 */
import { AssetType } from "@prisma/client";

/** The provenance of one booked slice, as needed to name its kits. */
export type SliceKitProvenance = {
  /** The live `AssetKit` membership row the slice was booked under, if any. */
  assetKitId: string | null;
  /** The kit the slice was booked under. Survives the membership's removal. */
  sourceKitId: string | null;
  /** The slice asset's LIVE kit memberships (`Asset.assetKits`). */
  assetKits: { kitId: string }[];
  /** The slice asset's type. Only an INDIVIDUAL asset answers from membership. */
  assetType: AssetType | null | undefined;
};

/**
 * Names the kits one booked slice holds.
 *
 * - A kit-driven slice holds exactly the kit it was booked under:
 *   `sourceKitId`, else the kit behind `assetKitId`. Not its asset's other kits.
 * - A standalone slice holds its asset's live kits only when the asset is
 *   INDIVIDUAL: one physical unit out on its own leaves its kit incomplete. A
 *   standalone QUANTITY_TRACKED slice draws on the free pool and holds no kit.
 *
 * @param slice - The slice's provenance and its asset's membership
 * @param kitIdByAssetKitId - `AssetKit.id` to `kitId`, covering the slice's
 *   `assetKitId`. A missing entry means the membership is not one the caller
 *   asked about, and resolves to no kit.
 * @returns The ids of the kits this slice holds; empty when it holds none
 */
export function resolveSliceKitIds(
  slice: SliceKitProvenance,
  kitIdByAssetKitId: ReadonlyMap<string, string>
): Set<string> {
  const kitIds = new Set<string>();

  if (slice.sourceKitId || slice.assetKitId) {
    const kitId =
      slice.sourceKitId ??
      (slice.assetKitId ? kitIdByAssetKitId.get(slice.assetKitId) : undefined);
    if (kitId) kitIds.add(kitId);
    return kitIds;
  }

  if (slice.assetType === AssetType.INDIVIDUAL) {
    for (const membership of slice.assetKits) {
      if (membership?.kitId) kitIds.add(membership.kitId);
    }
  }

  return kitIds;
}
