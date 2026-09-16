import {
  ASSET_IMAGE_RESIGNS_PER_RESPONSE,
  refreshExpiredAssetImages,
} from "~/modules/asset/service.server";

/**
 * The image columns a mobile row must carry to be repairable.
 *
 * `thumbnailImage` is optional because some mobile selects load only the full
 * image; such a row is re-signed for `mainImage` alone and keeps the shape it
 * was selected with.
 */
type RepairableMobileAssetImage = {
  id: string;
  mainImage: string | null;
  mainImageExpiration: Date | null;
  thumbnailImage?: string | null;
};

/**
 * Re-signs the lapsed asset image URLs in a mobile payload.
 *
 * `Asset.mainImage` and `Asset.thumbnailImage` are signed storage URLs that
 * stop loading once `mainImageExpiration` passes. The web repairs them from the
 * browser, and this API exposes the same repair at
 * `/api/mobile/asset/refresh-image/:assetId`, but the companion never calls it:
 * it renders a lapsed URL as an empty tile with no way back, and most of a
 * workspace's photos are lapsed at any moment because nothing renews them
 * between visits. So mobile read paths re-sign server-side instead, exactly as
 * the kit routes already do with `refreshExpiredKitImages`, and the app only
 * ever receives URLs that load.
 *
 * Rows come from a query already scoped to one workspace, so the caller passes
 * that `organizationId` rather than selecting it per row — the helper needs it
 * only to scope the write-back of the new URL. A cross-workspace read (the
 * scanner resolving a code owned by another workspace) passes the OWNING
 * workspace, not the caller's.
 *
 * Only the image fields are merged back, so each row keeps every other field it
 * was selected with, including an `organizationId` of its own.
 *
 * One call re-signs at most `ASSET_IMAGE_RESIGNS_PER_RESPONSE` rows, first rows
 * first. A booking or audit with more lapsed photos than that keeps the rest for
 * this response and repairs them on the next open, which keeps the request well
 * inside the companion's request timeout.
 *
 * @param assets - Rows carrying the image columns, in response order.
 * @param organizationId - The workspace the rows belong to.
 * @returns The same rows, with every lapsed URL replaced by a fresh one.
 * @see {@link file://./../asset/service.server.ts} `refreshExpiredAssetImages`
 * @see {@link file://./../../routes/api+/mobile+/asset.refresh-image.$assetId.ts}
 */
export async function refreshExpiredMobileAssetImages<
  T extends RepairableMobileAssetImage,
>(assets: T[], organizationId: string): Promise<T[]> {
  if (assets.length === 0) return assets;

  const refreshed = await refreshExpiredAssetImages(
    assets.map((asset) => ({
      id: asset.id,
      organizationId,
      mainImage: asset.mainImage,
      mainImageExpiration: asset.mainImageExpiration,
      thumbnailImage: asset.thumbnailImage ?? null,
    })),
    { maxRefreshes: ASSET_IMAGE_RESIGNS_PER_RESPONSE }
  );

  // The same asset can appear in more than one input row (a booking holds
  // several slices of one quantity-tracked asset), so index the results rather
  // than zipping the two arrays.
  const refreshedById = new Map(refreshed.map((asset) => [asset.id, asset]));

  return assets.map((asset) => {
    const fresh = refreshedById.get(asset.id);
    // An untouched row is returned exactly as it came in, so a select that
    // never asked for `thumbnailImage` does not grow the key here.
    if (!fresh || fresh.mainImage === asset.mainImage) {
      return asset;
    }

    const repaired =
      asset.thumbnailImage === undefined
        ? {
            mainImage: fresh.mainImage,
            mainImageExpiration: fresh.mainImageExpiration,
          }
        : {
            mainImage: fresh.mainImage,
            mainImageExpiration: fresh.mainImageExpiration,
            thumbnailImage: fresh.thumbnailImage,
          };

    return { ...asset, ...repaired };
  });
}

/**
 * Single-row form of {@link refreshExpiredMobileAssetImages}, for the scanner
 * paths.
 *
 * Their rows come from `MOBILE_ASSET_SELECT`, which always selects
 * `mainImageExpiration`, but are typed by `shapeMobileAssetResponse`, whose
 * parameter marks it optional because some callers build that argument by
 * hand. This form accepts that shape and returns the row with the exact keys it
 * came in with unless its photo was actually repaired. A row carrying no expiry
 * at all is treated as not lapsed.
 *
 * @param asset - A scanned asset row, before it is shaped for the response.
 * @param organizationId - The workspace that OWNS the asset, which for a
 *   cross-workspace scan is not the caller's.
 * @returns The row, with a lapsed photo replaced by a fresh one.
 */
export async function refreshExpiredMobileAssetImage<
  T extends {
    id: string;
    mainImage: string | null;
    thumbnailImage: string | null;
    mainImageExpiration?: Date | null;
  },
>(asset: T, organizationId: string): Promise<T> {
  const [repaired] = await refreshExpiredMobileAssetImages(
    [
      {
        id: asset.id,
        mainImage: asset.mainImage,
        thumbnailImage: asset.thumbnailImage,
        mainImageExpiration: asset.mainImageExpiration ?? null,
      },
    ],
    organizationId
  );

  if (repaired.mainImage === asset.mainImage) {
    return asset;
  }

  return {
    ...asset,
    mainImage: repaired.mainImage,
    thumbnailImage: repaired.thumbnailImage ?? null,
    mainImageExpiration: repaired.mainImageExpiration,
  };
}
