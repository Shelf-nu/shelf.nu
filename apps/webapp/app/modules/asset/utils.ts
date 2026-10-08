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
 * Returns true if the asset can be duplicated as it stands.
 *
 * A copy of a quantity-tracked asset starts with the source's stock, and a
 * quantity-tracked asset needs at least 1 unit, so a pool with no units in
 * stock cannot be copied until it is restocked. Individual assets can always
 * be duplicated. The duplicate dialog and `duplicateAsset` both read this, so
 * the button and the service refuse the same assets.
 *
 * @param asset - The source asset's `type` and `quantity` (workspace stock)
 * @returns false only for a quantity-tracked asset with no units in stock
 */
export function canDuplicateAsset(asset: {
  type?: AssetType | string | null;
  quantity?: number | null;
}): boolean {
  return !isQuantityTracked(asset) || (asset.quantity ?? 0) > 0;
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
 * The kit membership an asset row carries, in either projection we load:
 * the `assetKits` pivot rows (asset detail, scanner drawers, simple-mode index
 * rows) or the flattened `kit` scalar (advanced-mode index rows).
 */
type KitMembershipProjection = {
  type?: AssetType | string | null;
  assetKits?: Array<unknown> | null;
  kit?: unknown;
  // Index signature so loosely-typed list rows (`ListItemData`, which is
  // `{ id: string; [x: string]: any }`) are assignable. Without it TS's
  // weak-type check rejects them for having "no properties in common".
  [key: string]: unknown;
};

/**
 * Returns true when the asset is an individually tracked member of a kit.
 *
 * An INDIVIDUAL asset lives entirely inside its kit (the
 * `enforce_individual_asset_single_kit` trigger caps it at one membership), so
 * whatever happens to it on its own, a booking or a custody hand-over, happens
 * to the kit's unit too. Both are refused for such an asset: book or assign the
 * kit, or take the asset out of the kit first.
 *
 * `QUANTITY_TRACKED` assets are never kit members in this sense: each
 * `AssetKit` row claims only a *slice* of the pool, and a QT asset may belong
 * to several kits at once while still keeping free units that can be booked or
 * handed over on their own.
 *
 * Client-side checks built on this are advisory. The server refuses custody
 * with `assertNotKitMembers` and over-booking with the windowed availability
 * guards in `createBooking` / `updateBookingAssets`.
 *
 * @param asset - An asset-like object carrying `type` plus `assetKits` and/or `kit`
 * @returns true for an INDIVIDUAL asset that belongs to a kit
 */
export function isIndividualKitMember(
  asset?: KitMembershipProjection | null
): boolean {
  if (!asset) return false;

  const isPartOfKit = (asset.assetKits?.length ?? 0) > 0 || !!asset.kit;

  return isPartOfKit && !isQuantityTracked(asset);
}

/** A kit as either index row shape carries it: only its status is read. */
type RowKit = { status?: string | null } | null | undefined;

/**
 * Returns the status of the kit an index row's asset belongs to, or `null` when
 * it is in no kit.
 *
 * Assets index rows carry kit membership in two shapes: simple mode loads the
 * `assetKits` pivot rows (`assetIndexFields`), advanced mode a flattened `kit`
 * object built in raw SQL. Read the kit through this helper rather than
 * `row.kit`, which is absent from every simple-mode row and so silently reads
 * as "no kit" there. Both shapes name the asset's primary (oldest) kit.
 *
 * @param asset - An index row, in either mode
 * @returns The kit's status (e.g. `"IN_CUSTODY"`), or `null` for no kit
 */
export function getRowKitStatus(
  asset?: {
    kit?: RowKit;
    assetKits?: Array<{ kit?: RowKit }> | null;
    // Index signature so loosely-typed list rows (`ListItemData`) are
    // assignable; see `KitMembershipProjection`.
    [key: string]: unknown;
  } | null
): string | null {
  return asset?.kit?.status ?? asset?.assetKits?.[0]?.kit?.status ?? null;
}

/**
 * Returns true when the asset's kit membership should block booking it
 * directly (outside of its kit). Same rule as {@link isIndividualKitMember}:
 * an individually tracked kit member is booked through its kit, a
 * quantity-tracked asset's free units stay bookable on their own (the booking
 * page's asset picker allows the same).
 *
 * @param asset - An asset-like object carrying `type` plus `assetKits` and/or `kit`
 * @returns true when direct booking must be disabled because of a kit
 */
export function isDirectBookingBlockedByKit(
  asset?: KitMembershipProjection | null
): boolean {
  return isIndividualKitMember(asset);
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

/**
 * One placement row in the mobile JSON contract: where units of an asset
 * sit, and whether the row is owned by a kit.
 *
 * `quantity` is the per-row `AssetLocation.quantity` (units placed at the
 * location — NOT `Asset.quantity`, the workspace stock). `viaKit` is set for
 * kit-driven rows, which the mobile placements editor renders read-only:
 * they change through the kit (membership qty or kit location), never
 * through the asset's own placement flows.
 */
export type MobileAssetPlacement = {
  locationId: string;
  locationName: string;
  quantity: number;
  viaKit: { id: string; name: string } | null;
};

/**
 * Flattens `AssetLocation` pivot rows into the mobile `placements` array.
 *
 * Manual rows come first (they are the editable set), kit-driven rows after
 * (read-only context). Rows whose location relation failed to load are
 * dropped rather than shipped nameless.
 *
 * @param rows - Pivot rows selected with `quantity`, `assetKitId`, the
 *   `location` (id + name) and, for kit-driven rows, `assetKit.kit`.
 * @returns The flattened, ordered placement list for mobile payloads.
 */
export function shapeMobileAssetPlacements(
  rows: Array<{
    quantity: number;
    assetKitId?: string | null;
    location?: { id: string; name: string } | null;
    assetKit?: { kit: { id: string; name: string } | null } | null;
  }>
): MobileAssetPlacement[] {
  const shaped = rows.flatMap((row) => {
    if (!row.location) return [];
    return [
      {
        locationId: row.location.id,
        locationName: row.location.name,
        quantity: row.quantity,
        viaKit: row.assetKitId ? row.assetKit?.kit ?? null : null,
      },
    ];
  });
  return [
    ...shaped.filter((p) => p.viaKit === null),
    ...shaped.filter((p) => p.viaKit !== null),
  ];
}
