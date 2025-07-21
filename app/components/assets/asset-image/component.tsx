import { useEffect, useState, useCallback } from "react";

import { useFetcher } from "@remix-run/react";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { usePlaceholderImage } from "~/hooks/use-placeholder-image";
import type { loader as refreshImageLoader } from "~/routes/api+/asset.refresh-main-image";
import { DIALOG_CLOSE_SHORTCUT } from "~/utils/constants";
import { tw } from "~/utils/tw";
import type { AssetImageProps } from "./types";
import { isAssetForPreview } from "./utils";
// Import the debug helper (uncomment during debugging)
// import { debugImageUrl } from "~/utils/debug-helpers";

export const AssetImage = ({
  asset,
  className,
  withPreview = false,
  useThumbnail = true,
  alt,
  ...rest
}: AssetImageProps) => {
  const imageFetcher = useFetcher<typeof refreshImageLoader>();
  const thumbnailFetcher = useFetcher<{ asset: { thumbnailImage: string } }>();
  const placeholderImage = usePlaceholderImage();

  const [isLoading, setIsLoading] = useState(true);
  const [isImageError, setIsImageError] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Track if we've already tried refreshing to prevent loops
  const [hasAttemptedRefresh, setHasAttemptedRefresh] = useState(false);

  const { id: assetId, thumbnailImage } = asset;

  // Safely access main image properties using the type guard
  const hasMainImageData = "mainImage" in asset && asset.mainImage != null;
  const isPreviewAsset = isAssetForPreview(asset);

  // Extract main image data when available
  const mainImage = hasMainImageData ? asset.mainImage : null;
  const mainImageExpiration = isPreviewAsset ? asset.mainImageExpiration : null;

  // Get updated images from fetchers when available
  const updatedAssetMainImage = imageFetcher.data?.error
    ? null
    : imageFetcher.data?.asset?.mainImage;
  const updatedAssetThumbnailImage = imageFetcher.data?.error
    ? null
    : imageFetcher.data?.asset?.thumbnailImage;

  // Get thumbnail from thumbnail fetcher if available
  const dynamicThumbnailImage = thumbnailFetcher.data?.asset?.thumbnailImage;

  // Choose the appropriate image URL with fallbacks
  // Create a stable cache-busting key that won't change on re-renders
  const [cacheBuster] = useState(isImageError ? `?t=${Date.now()}` : "");

  const currentThumbnail =
    dynamicThumbnailImage || updatedAssetThumbnailImage || thumbnailImage;
  const currentMainImage = updatedAssetMainImage || mainImage;

  // Only add cache-buster if we've had an error and attempted refresh
  const imageUrl =
    (useThumbnail && currentThumbnail
      ? currentThumbnail
      : currentMainImage || placeholderImage) +
    (hasAttemptedRefresh && isImageError ? cacheBuster : "");

  // For preview dialog, also add cache buster only when needed
  const previewImageUrl =
    (currentMainImage || placeholderImage) +
    (hasAttemptedRefresh && isImageError ? cacheBuster : "");

  // Safe refresh function that prevents loops
  const refreshImage = useCallback(() => {
    if (assetId && mainImage && !hasAttemptedRefresh) {
      setHasAttemptedRefresh(true);
      imageFetcher.submit(
        { assetId, mainImage },
        {
          method: "get",
          action: "/api/asset/refresh-main-image",
        }
      );
    }
  }, [assetId, mainImage, imageFetcher, hasAttemptedRefresh]);

  // Safe thumbnail generator that prevents loops
  const generateThumbnail = useCallback(() => {
    if (assetId && !hasAttemptedRefresh) {
      setHasAttemptedRefresh(true);
      thumbnailFetcher.submit(
        { assetId },
        {
          method: "get",
          action: "/api/asset/generate-thumbnail",
        }
      );
    }
  }, [assetId, thumbnailFetcher, hasAttemptedRefresh]);

  const handleImageLoad = () => {
    // Successfully loaded, clear both loading and error states
    setIsLoading(false);
    if (isImageError) {
      setIsImageError(false);
    }
  };

  const handleImageError = () => {
    setIsLoading(false);

    // Only set error state and refresh once
    if (!isImageError && !hasAttemptedRefresh) {
      setIsImageError(true);
      refreshImage();
    }
  };

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  // Check for image expiration and generate thumbnail on component mount only
  useEffect(() => {
    // Reset refresh attempt state when component mounts
    setHasAttemptedRefresh(false);

    // Check for expiration
    if (withPreview && mainImage && mainImageExpiration) {
      try {
        const now = new Date();
        const expiration = new Date(mainImageExpiration);
        // Only refresh if it's actually expired and we haven't tried yet
        if (now > expiration && !hasAttemptedRefresh) {
          refreshImage();
        }
      } catch (e) {
        // If date parsing fails, don't refresh
        // eslint-disable-next-line no-console
        console.error("Error parsing expiration date", e);
      }
    }

    // Generate thumbnail if needed and we haven't tried yet
    if (
      useThumbnail &&
      mainImage &&
      !thumbnailImage &&
      !dynamicThumbnailImage &&
      !hasAttemptedRefresh
    ) {
      generateThumbnail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array to run only on mount

  // Reset error state when fetchers successfully provide new image URLs
  useEffect(() => {
    const hasValidNewImage =
      updatedAssetMainImage || updatedAssetThumbnailImage;

    if (hasValidNewImage && isImageError) {
      // We have new images, clear the error state but don't trigger new loading
      setIsImageError(false);
    }
  }, [updatedAssetMainImage, updatedAssetThumbnailImage, isImageError]);

  // Debug the image URLs - uncomment during debugging
  // useEffect(() => {
  //   if (currentMainImage) {
  //     console.log("AssetImage - Main Image URL:", assetId);
  //     debugImageUrl(currentMainImage);
  //   }
  //   if (currentThumbnail) {
  //     console.log("AssetImage - Thumbnail URL:", assetId);
  //     debugImageUrl(currentThumbnail);
  //   }
  // }, [assetId, currentMainImage, currentThumbnail]);

  // Handle dialog keyboard shortcuts
  useEffect(
    function handleEscShortcut() {
      if (!withPreview || !isDialogOpen) {
        return;
      }

      function handleKeydown(event: KeyboardEvent) {
        if (event.key === DIALOG_CLOSE_SHORTCUT) {
          event.preventDefault();
          handleCloseDialog();
        }
      }

      window.addEventListener("keydown", handleKeydown);
      return () => window.removeEventListener("keydown", handleKeydown);
    },
    [isDialogOpen, withPreview]
  );

  return (
    <>
      <div className={tw("relative overflow-hidden", className)}>
        {(isLoading ||
          (useThumbnail &&
            (thumbnailFetcher.state === "submitting" ||
              (imageFetcher.state === "submitting" && !thumbnailImage)))) && (
          <div
            className={tw(
              "absolute inset-0 flex items-center justify-center bg-color-100",
              "transition-opacity"
            )}
          >
            <Spinner className="[&_.spinner]:before:border-t-gray-400" />
          </div>
        )}

        <img
          onClick={withPreview ? handleOpenDialog : undefined}
          src={imageUrl}
          width={108}
          height={108}
          className={tw(
            "size-full object-cover",
            withPreview && "cursor-pointer"
          )}
          alt={alt}
          onLoad={handleImageLoad}
          onError={handleImageError}
          loading="lazy"
          decoding="async"
          {...rest}
        />
      </div>
      {withPreview && (
        <DialogPortal>
          <Dialog
            open={isDialogOpen}
            onClose={handleCloseDialog}
            className="h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-[90%]"
            title={
              <div>
                <div className="text-lg font-semibold text-color-900">
                  {alt}
                </div>
                <div className="text-sm font-normal text-color-600">
                  1 image(s)
                </div>
              </div>
            }
          >
            <div
              className={
                "relative z-10 flex h-full flex-col bg-surface shadow-lg md:rounded"
              }
            >
              <div className="flex max-h-[calc(100%-4rem)] grow items-center justify-center border-y border-color-200 bg-color-50">
                {/* Always use full-size image in the preview dialog */}
                <img src={previewImageUrl} className={"max-h-full"} alt={alt} />
              </div>
              <div className="flex w-full justify-center gap-3 px-6 py-3 md:justify-end">
                <Button to={`/assets/${assetId}/edit`} variant="secondary">
                  Edit image(s)
                </Button>
                <Button variant="secondary" onClick={handleCloseDialog}>
                  Close
                </Button>
              </div>
            </div>
          </Dialog>
        </DialogPortal>
      )}
    </>
  );
};
