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
