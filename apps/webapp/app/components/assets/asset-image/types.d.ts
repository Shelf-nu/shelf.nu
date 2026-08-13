import type { Asset } from "@prisma/client";
import type { AssetWithResolvableImage } from "~/modules/asset/image-resolution";

/**
 * The model half of the image cascade.
 *
 * REQUIRED on every `AssetImage` call site. An optional field would let a
 * surface silently drop assets that inherit their image from their model down
 * to the placeholder — so the loader for each surface must supply it, and
 * typecheck is what enforces that. Pass `null` only where the asset genuinely
 * cannot have a model, with a `// why:` comment at the call site.
 *
 * @see {@link file://./../../../modules/asset/image-select.ts}
 */
export type AssetModelImage = AssetWithResolvableImage["assetModel"];

// Helper type for when you only need thumbnail data
export type AssetForThumbnail = Pick<Asset, "id" | "thumbnailImage"> & {
  mainImage?: Asset["mainImage"];
  assetModel: AssetModelImage;
};

// Helper type for when you need full image data (for preview)
export type AssetForPreview = Pick<
  Asset,
  "id" | "mainImage" | "thumbnailImage" | "mainImageExpiration"
> & { assetModel: AssetModelImage };

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
