/**
 * Asset Status Badge — public surface
 *
 * Barrel that keeps consumers importing from
 * `~/components/assets/asset-status-badge` stable while the internals
 * are organised across focused files. Add new internal modules below
 * if they need to be consumed outside this folder; don't widen the
 * surface needlessly.
 */

export { AssetStatusBadge } from "./asset-status-badge";
export { assetStatusColorMap, userFriendlyAssetStatus } from "./status-labels";
