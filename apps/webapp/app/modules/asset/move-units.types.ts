/**
 * Move Units Types — Phase 4c contract
 *
 * Shared types + constants for the split/merge UX. Used by:
 * - `moveAssetLocationUnits` (modules/asset/service.server.ts)
 * - `moveAssetKitUnits` (modules/kit/service.server.ts)
 * - `placeUnplacedUnits` (modules/asset/service.server.ts)
 * - `MoveUnitsDialog` component (components/assets/move-units-dialog.tsx)
 * - The action handler on `assets.$assetId.overview.tsx`
 *
 * Background: Phase 4c surfaces the user-facing "move N units between two
 * pivot rows" flow on the asset detail page. Schema is already in place
 * (AssetLocation + AssetKit pivots from 4a/4b with `quantity` columns and
 * the orthogonal-axes triggers); 4c is service + UX work on top.
 *
 * @see PRD `docs/proposals/quantitative-assets.md` lines 823-828
 * @see Plan `superpowers/PHASE-4C-SPLIT-MERGE-UX.md`
 */

/**
 * Axis along which a Phase 4c "move units" operation acts.
 *
 * - `location`       — move between AssetLocation rows (manual pivot only,
 *                      i.e. rows where `assetKitId IS NULL`). Kit-driven
 *                      rows must be moved via the `kit` axis.
 * - `kit`            — move between AssetKit rows. Cascades the new
 *                      quantities to kit-driven BookingAsset slices
 *                      (per the existing `updateKitAssets` pattern).
 * - `place-unplaced` — one-sided variant: place N of the asset's unplaced
 *                      units at a destination location. No source row to
 *                      decrement; fills the gap between `Asset.quantity`
 *                      and `sum(AssetLocation.quantity WHERE assetKitId IS NULL)`.
 */
export type MoveAxis = "location" | "kit" | "place-unplaced";

/**
 * Hidden form-field name used by `MoveUnitsDialog` and consumed by the
 * route action to dispatch on `MoveAxis`. Kept here so both sides agree
 * on the same string.
 */
export const MOVE_UNITS_INTENT_FIELD = "moveUnitsIntent" as const;

/** Arguments for moving units between two `AssetLocation` rows. */
export interface MoveAssetLocationUnitsArgs {
  assetId: string;
  organizationId: string;
  /** Acting user — recorded on the paired Notes + ActivityEvents. */
  userId: string;
  /** Manual source row (must have `assetKitId IS NULL`). */
  fromLocationId: string;
  /** Manual destination row (created if it does not yet exist). */
  toLocationId: string;
  /** Number of units to move. Must be ≥ 1 and ≤ source row's `quantity`. */
  quantity: number;
}

/** Arguments for moving units between two `AssetKit` rows. */
export interface MoveAssetKitUnitsArgs {
  assetId: string;
  organizationId: string;
  userId: string;
  fromKitId: string;
  toKitId: string;
  quantity: number;
}

/**
 * Arguments for placing unplaced units of an asset at a destination location.
 * One-sided variant of move — no source row, just fills the gap.
 */
export interface PlaceUnplacedUnitsArgs {
  assetId: string;
  organizationId: string;
  userId: string;
  toLocationId: string;
  quantity: number;
}

/**
 * Result of a `moveAssetLocationUnits` / `moveAssetKitUnits` call.
 * Returned so the caller can update optimistic UI without re-fetching.
 */
export interface MoveUnitsResult {
  /** Source row's new `quantity` post-tx. `0` when the source row was deleted. */
  fromQuantity: number;
  /** Destination row's new `quantity` post-tx. */
  toQuantity: number;
  /** `true` when the source row hit 0 and was deleted to keep reads clean. */
  sourceRowDeleted: boolean;
  /**
   * UUID used to pair the two `ASSET_LOCATION_CHANGED` / `ASSET_KIT_CHANGED`
   * events emitted by the move (one for the from-side, one for the to-side).
   * Surfaced on `ActivityEvent.meta.moveCorrelationId` so reports can
   * reconstruct moves.
   */
  moveCorrelationId: string;
}

/** Result of a `placeUnplacedUnits` call — one-sided so no source qty. */
export interface PlaceUnplacedUnitsResult {
  toQuantity: number;
  /** UUID on the single `ASSET_LOCATION_CHANGED` event's `meta.moveCorrelationId`. */
  moveCorrelationId: string;
}
