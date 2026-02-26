import type { Asset } from "@prisma/client";

// Helper type for when you only need thumbnail data
export type AssetForThumbnail = Pick<Asset, "id" | "thumbnailImage">;

// Helper type for when you need full image data (for preview)
export type AssetForPreview = Pick<
  Asset,
  "id" | "mainImage" | "thumbnailImage" | "mainImageExpiration"
>;
// Base props that are always required
export type BaseAssetImageProps = {
  asset: AssetForThumbnail;
  alt: string;
  className?: string;
  useThumbnail?: boolean;
  rest?: HTMLImageElement;
};

// Props when withPreview is true - requires full image data
export type WithPreviewProps = BaseAssetImageProps & {
  withPreview: true;
  asset: AssetForPreview;
};

// Props when withPreview is false or undefined - only needs thumbnail data
export type WithoutPreviewProps = BaseAssetImageProps & {
  withPreview?: false;
};

// Combined type
export type AssetImageProps = WithPreviewProps | WithoutPreviewProps;
