/**
 * Asset Image Resolution
 *
 * Single source of truth for which image an asset displays. Assets may inherit
 * their `AssetModel`'s cover image, so the URL rendered on any surface is a
 * cascade rather than a plain column read:
 *
 *   1. the asset's own `mainImage`
 *   2. otherwise its model's `image`
 *   3. otherwise the static placeholder
 *
 * Nothing is copied between rows — the model's image is resolved at render
 * time. One upload therefore serves every asset of that model, the URL is
 * public and never expires, and a page full of same-model assets shares a
 * single cacheable object.
 *
 * Deliberately pure and client-safe (no `*.server` imports, no database
 * access) so the same function backs the web component, the JSON API
 * serializers and the booking PDF — web and mobile cannot disagree about the
 * cascade.
 *
 * @see {@link file://./../../components/assets/asset-image/component.tsx}
 * @see {@link file://./image-select.ts}
 */

/** Static placeholder shown when neither the asset nor its model has an image. */
export const ASSET_IMAGE_PLACEHOLDER = "/static/images/asset-placeholder.jpg";

/**
 * Where the rendered image came from.
 *
 * `"model"` is load-bearing beyond display: an inherited image lives on the
 * AssetModel row, so the per-asset repair endpoints
 * (`/api/asset/refresh-main-image`, `/api/asset/generate-thumbnail`) must not
 * fire for it — they would write to the wrong row, and firing one per list row
 * is what turns a large page into a rate-limit event.
 */
export type AssetImageSource = "asset" | "model" | "placeholder";

/** The minimum image shape any surface must load to resolve an asset's image. */
export type AssetWithResolvableImage = {
  mainImage: string | null;
  thumbnailImage: string | null;
  assetModel: {
    image: string | null;
    thumbnailImage: string | null;
  } | null;
};

/** The resolved URLs plus their provenance. */
export type ResolvedAssetImage = {
  /** URL to render at list / 108px size. */
  thumbnailUrl: string;
  /** URL to render at full size (preview dialog, PDF). */
  fullUrl: string;
  source: AssetImageSource;
};

/**
 * Resolves the image an asset should display.
 *
 * The tier is decided by `mainImage` **alone** — the thumbnail is only
 * consulted *within* the winning tier. An asset whose main image was cleared
 * but whose `thumbnailImage` lingered must not render a thumbnail of an image
 * it no longer has.
 *
 * @param asset - The asset's own image fields plus its model's, if linked
 * @returns The URLs to render and where they came from
 */
export function resolveAssetImage(
  asset: AssetWithResolvableImage
): ResolvedAssetImage {
  if (asset.mainImage) {
    return {
      fullUrl: asset.mainImage,
      thumbnailUrl: asset.thumbnailImage ?? asset.mainImage,
      source: "asset",
    };
  }

  const modelImage = asset.assetModel?.image;
  if (modelImage) {
    return {
      fullUrl: modelImage,
      thumbnailUrl: asset.assetModel?.thumbnailImage ?? modelImage,
      source: "model",
    };
  }

  return {
    fullUrl: ASSET_IMAGE_PLACEHOLDER,
    thumbnailUrl: ASSET_IMAGE_PLACEHOLDER,
    source: "placeholder",
  };
}

/**
 * Collapses the cascade into the flat image fields a JSON client already reads.
 *
 * Used by the `api+` and `api+/mobile+` asset routes. The companion app cannot
 * be updated in lockstep with the server (native binary, no OTA for native
 * changes), so it must inherit correctly with no client release: the resolved
 * URLs are written back into `mainImage` / `thumbnailImage`, and the nested
 * `assetModel` object is **dropped** rather than shipped alongside them — two
 * sources of truth for one decision is how clients drift.
 *
 * `mainImage` stays `null` for the placeholder case so existing client-side
 * "no image" branches keep working.
 *
 * @param asset - An asset row selected with `ASSET_MODEL_IMAGE_SELECT`
 * @returns The same row with resolved image fields, `imageSource`, and no
 *   `assetModel` key
 */
export function serializeAssetImage<T extends AssetWithResolvableImage>({
  assetModel,
  ...asset
}: T): Omit<T, "assetModel"> & {
  mainImage: string | null;
  thumbnailImage: string | null;
  imageSource: AssetImageSource;
} {
  const resolved = resolveAssetImage({
    mainImage: asset.mainImage,
    thumbnailImage: asset.thumbnailImage,
    assetModel,
  });

  const isPlaceholder = resolved.source === "placeholder";

  return {
    ...asset,
    mainImage: isPlaceholder ? null : resolved.fullUrl,
    thumbnailImage: isPlaceholder ? null : resolved.thumbnailUrl,
    imageSource: resolved.source,
  };
}
