import { useEffect, useState } from "react";
import type { Asset } from "@prisma/client";

import { useFetcher } from "@remix-run/react";
import type { action } from "~/routes/api+/asset.refresh-main-image";
import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

export const DIALOG_CLOSE_SHORTCUT = "Escape";

type AssetImageProps = {
  asset: {
    assetId: Asset["id"];
    mainImage: Asset["mainImage"];
    thumbnailImage?: Asset["thumbnailImage"];
    mainImageExpiration: Date | string | null;
    alt: string;
  };
  withPreview?: boolean;
  className?: string;
  useThumbnail?: boolean;
  rest?: HTMLImageElement;
};

export const AssetImage = ({
  asset,
  className,
  withPreview = false,
  useThumbnail = true,
  ...rest
}: AssetImageProps) => {
  const imageFetcher = useFetcher<typeof action>();
  const thumbnailFetcher = useFetcher<{ asset: { thumbnailImage: string } }>();

  const { assetId, mainImage, thumbnailImage, mainImageExpiration, alt } =
    asset;
  const updatedAssetMainImage = imageFetcher.data?.error
    ? null
    : imageFetcher.data?.asset.mainImage;
  const updatedAssetThumbnailImage = imageFetcher.data?.error
    ? null
    : imageFetcher.data?.asset.thumbnailImage;

  // Get thumbnail from thumbnail fetcher if available
  const dynamicThumbnailImage = thumbnailFetcher.data?.asset?.thumbnailImage;

  // Choose the appropriate image URL
  const currentThumbnail =
    dynamicThumbnailImage || thumbnailImage || updatedAssetThumbnailImage;
  const currentMainImage = mainImage || updatedAssetMainImage;

  const imageUrl =
    useThumbnail && currentThumbnail
      ? currentThumbnail
      : currentMainImage || "/static/images/asset-placeholder.jpg";

  // For preview dialog, always use the full-size image
  const previewImageUrl =
    currentMainImage || "/static/images/asset-placeholder.jpg";

  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  // Check for image expiration - this will also handle thumbnail generation
  useEffect(() => {
    if (mainImage && mainImageExpiration) {
      const now = new Date();
      const expiration = new Date(mainImageExpiration);
      if (now > expiration) {
        imageFetcher.submit(
          { assetId, mainImage: mainImage || "" },
          {
            method: "post",
            action: "/api/asset/refresh-main-image",
          }
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if we need to generate a thumbnail (separate from refresh)
  useEffect(() => {
    // Only generate if:
    // 1. We want to use thumbnails
    // 2. We have a main image
    // 3. We don't have a thumbnail yet
    // 4. We're not already fetching one
    // 5. The refresh fetcher is not already handling it
    if (
      useThumbnail &&
      mainImage &&
      !thumbnailImage &&
      !dynamicThumbnailImage &&
      thumbnailFetcher.state === "idle" &&
      imageFetcher.state === "idle"
    ) {
      thumbnailFetcher.submit(
        { assetId },
        {
          method: "post",
          action: "/api/asset/generate-thumbnail",
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useThumbnail, mainImage, thumbnailImage, assetId, imageFetcher.state]);

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
              "absolute inset-0 flex items-center justify-center bg-gray-100",
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
                <div className="text-lg font-semibold text-gray-900">
                  {asset.alt}
                </div>
                <div className="text-sm font-normal text-gray-600">
                  1 image(s)
                </div>
              </div>
            }
          >
            <div
              className={
                "relative z-10 flex h-full flex-col bg-white shadow-lg md:rounded"
              }
            >
              <div className="flex max-h-[calc(100%-4rem)] grow items-center justify-center border-y border-gray-200 bg-gray-50">
                {/* Always use full-size image in the preview dialog */}
                <img src={previewImageUrl} className={"max-h-full"} alt={alt} />
              </div>
              <div className="flex w-full justify-center gap-3 px-6 py-3 md:justify-end">
                <Button
                  to={`/assets/${asset.assetId}/edit`}
                  variant="secondary"
                >
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
