/**
 * Shared asset utility functions.
 *
 * This file is importable from both server and client code.
 * For server-only utilities, use `utils.server.ts`.
 */

import type { AssetType } from "@prisma/client";

/**
 * Returns true if the asset is quantity-tracked.
 *
 * Accepts any object with an optional `type` field, or a raw
 * `AssetType` value. This keeps call sites DRY instead of
 * repeating `=== "QUANTITY_TRACKED"` comparisons everywhere.
 *
 * @param assetOrType - An asset-like object with `type`, or a raw AssetType value
 * @returns true when the asset type is QUANTITY_TRACKED
 */
export function isQuantityTracked(
  assetOrType?:
    | { type?: AssetType | string | null; [key: string]: unknown }
    | AssetType
    | string
    | null
): boolean {
  if (!assetOrType) return false;
  const type = typeof assetOrType === "string" ? assetOrType : assetOrType.type;
  return type === "QUANTITY_TRACKED";
}

/**
 * Returns the asset's primary kit (or null) from the `AssetKit` pivot.
 *
 * `TKit` is inferred from the asset's projected shape: pass any value
 * whose type carries `assetKits: { kit: ... }[]` and the helper picks
 * up the nested kit type automatically. Callers loading a deeply-merged
 * shape Prisma fails to narrow can still override with an explicit
 * `getPrimaryKit<MyKit>(asset as unknown)` cast at the call site.
 *
 * @returns The first pivot row's kit, or `null` when the asset has no kit
 */
export function getPrimaryKit<TKit>(
  asset: { assetKits?: Array<{ kit?: TKit | null }> } | null | undefined
): TKit | null {
  return asset?.assetKits?.[0]?.kit ?? null;
}

/**
 * Returns the asset's primary location (or null) from the
 * `AssetLocation` pivot.
 *
 * For INDIVIDUAL assets the `enforce_individual_asset_single_location`
 * trigger guarantees ≤1 row, so "primary" means "the only location".
 * For QUANTITY_TRACKED assets spanning multiple locations, "primary" is
 * the first pivot row (callers needing the full breakdown should read
 * `asset.assetLocations` directly).
 *
 * `TLoc` is inferred from the asset's projected shape — no need to
 * re-declare the location shape at every call site as long as the
 * loader projected it. Callers loading a shape Prisma fails to narrow
 * can override with an explicit `getPrimaryLocation<MyLoc>(asset as unknown)`.
 *
 * @returns The first pivot row's location, or `null` when the asset is unplaced
 */
export function getPrimaryLocation<TLoc>(
  asset:
    | { assetLocations?: Array<{ location?: TLoc | null }> }
    | null
    | undefined
): TLoc | null {
  return asset?.assetLocations?.[0]?.location ?? null;
}
