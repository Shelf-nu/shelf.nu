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
 * `AssetKit.@@unique([assetId])` enforces "at most one kit per asset",
 * so "primary" means "the only kit". The generic lets callers ask for
 * whatever kit shape their loader actually projected (e.g. `{ id; name }`
 * vs `{ id; name; status }`) without losing precision.
 *
 * The `unknown` cast inside is a workaround for Prisma's `MergeInclude`
 * not always preserving the deep `assetKits.select.kit` shape through
 * the `getAsset` / `getKit` generics — centralising the cast here keeps
 * the surrounding code clean.
 *
 * @param asset - Any asset-like value loaded with `assetKits: { select: { kit: { ... } } }`
 * @returns The first pivot row's kit, narrowed to `TKit`, or `null` when the asset has no kit
 */
export function getPrimaryKit<TKit>(asset: unknown): TKit | null {
  const pivot = (asset as { assetKits?: Array<{ kit?: TKit | null }> })
    ?.assetKits;
  return pivot?.[0]?.kit ?? null;
}
