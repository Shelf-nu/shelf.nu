/**
 * AssetPrintImage
 *
 * An asset's photo on a printed sheet: the booking checklist and the audit
 * receipt. Every print surface that shows an asset photo renders it through
 * this component.
 *
 * Deliberately NOT `<AssetImage>`. That component lazy-loads and lays a loading
 * spinner over the photo until the browser reports it loaded, and
 * `react-to-print` copies the page as it is, so any photo that had not loaded
 * yet would print as a grey box with a spinner. A plain `<img>` with no
 * `loading` attribute loads straight away, and `react-to-print` waits for every
 * `<img>` before it prints.
 *
 * The URL follows the same cascade as every web surface (`resolveAssetImage`):
 * the asset's own thumbnail, then its model's cover, then the placeholder.
 *
 * @see {@link file://./../../modules/asset/image-resolution.ts}
 * @see {@link file://./asset-code-print-text.tsx} the Code cell's print twin
 */

import type { SyntheticEvent } from "react";
import type { AssetWithResolvableImage } from "~/modules/asset/image-resolution";
import {
  ASSET_IMAGE_PLACEHOLDER,
  resolveAssetImage,
} from "~/modules/asset/image-resolution";
import { tw } from "~/utils/tw";

/**
 * Replaces a photo that failed to load with the placeholder, so the sheet
 * prints the placeholder instead of a broken-image icon. A signed URL that
 * lapsed and was not re-signed is the usual cause.
 *
 * Sets the `src` attribute on the element itself: `react-to-print` clones the
 * DOM, so the clone must carry the swapped URL. The placeholder check stops a
 * missing placeholder from firing this again forever.
 */
function showPlaceholderOnError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (image.getAttribute("src") !== ASSET_IMAGE_PLACEHOLDER) {
    image.setAttribute("src", ASSET_IMAGE_PLACEHOLDER);
  }
}

/**
 * Renders one asset's photo for print.
 *
 * @param props.asset - The asset's own image fields plus its model's cover.
 *   `assetModel` is required: `null` is a real answer ("no model"), and an
 *   optional prop would hide a loader that forgot to select it.
 * @param props.alt - Alternative text for the photo
 * @param props.className - Size classes for the photo
 * @returns The `<img>` element
 */
export function AssetPrintImage({
  asset,
  alt,
  className,
}: {
  asset: AssetWithResolvableImage;
  alt: string;
  className?: string;
}) {
  const { thumbnailUrl } = resolveAssetImage(asset);

  return (
    <img
      src={thumbnailUrl}
      alt={alt}
      className={tw("rounded-[2px] object-cover", className)}
      onError={showPlaceholderOnError}
    />
  );
}
