import type { AssetForPreview, AssetForThumbnail } from "./types";

// Type guard functions to help with type checking
export function hasMainImage(asset: {
  mainImage?: unknown;
}): asset is { mainImage: string } {
  return typeof asset.mainImage === "string" && asset.mainImage.length > 0;
}

export function hasPreviewData(asset: unknown): asset is AssetForPreview {
  return (
    typeof asset === "object" &&
    asset !== null &&
    "id" in asset &&
    "mainImage" in asset &&
    "mainImageExpiration" in asset
  );
}

// A utility to check if an asset is already of the preview type
export function isAssetForPreview(
  asset: AssetForThumbnail | AssetForPreview
): asset is AssetForPreview {
  return "mainImage" in asset && "mainImageExpiration" in asset;
}
