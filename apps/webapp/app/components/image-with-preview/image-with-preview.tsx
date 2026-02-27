import type { HTMLProps, KeyboardEvent } from "react";
import { useState, useCallback } from "react";
import { RefreshCwIcon } from "lucide-react";
import { ChevronRight } from "~/components/icons/library";
import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type ImageItem = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  alt: string;
};

type ImageWithPreviewProps = {
  className?: string;
  imageUrl?: string;
  thumbnailUrl: string | null | undefined;
  withPreview?: boolean;
  alt: string;
  editImageUrl?: string;
  // Optional: Pass array of images and current image ID for navigation
  images?: ImageItem[];
  currentImageId?: string;
  onNavigate?: (imageId: string) => void;
  // Set to true when rendering inside another dialog/modal to avoid portal conflicts
  disablePortal?: boolean;
} & HTMLProps<HTMLImageElement>;

export default function ImageWithPreview({
  className,
  imageUrl,
  thumbnailUrl,
  withPreview = false,
  alt,
  editImageUrl,
  images,
  currentImageId,
  onNavigate,
  disablePortal = false,
  ...restProps
}: ImageWithPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isImageError, setIsImageError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  // Determine if navigation is enabled
  const hasNavigation = Boolean(images && images.length > 1);

  // Get current image data
  const currentImage = hasNavigation
    ? images![currentIndex]
    : { imageUrl: imageUrl!, alt, thumbnailUrl };

  const canGoPrevious = hasNavigation && currentIndex > 0;
  const canGoNext = hasNavigation && currentIndex < images!.length - 1;

  const handlePrevious = useCallback(() => {
    if (canGoPrevious) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      if (onNavigate && images) {
        onNavigate(images[newIndex].id);
      }
    }
  }, [canGoPrevious, currentIndex, onNavigate, images]);

  const handleNext = useCallback(() => {
    if (canGoNext) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      if (onNavigate && images) {
        onNavigate(images[newIndex].id);
      }
    }
  }, [canGoNext, currentIndex, onNavigate, images]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!hasNavigation) return;
    if (e.key === "ArrowLeft" && canGoPrevious) {
      e.preventDefault();
      handlePrevious();
    } else if (e.key === "ArrowRight" && canGoNext) {
      e.preventDefault();
      handleNext();
    }
  };

  function handleOpenDialog() {
    if (!imageUrl) {
      return;
    }
    // Set current index when opening if navigation enabled
    if (images && currentImageId) {
      const index = images.findIndex((img) => img.id === currentImageId);
      if (index !== -1) {
        setCurrentIndex(index);
      }
    }

    setOpen(true);
  }

  function handleCloseDialog() {
    setOpen(false);
  }

  function handleDialogContentMount(node: HTMLDivElement | null) {
    if (node) {
      node.focus();
    }
  }

  function handleImageLoad() {
    setIsLoading(false);
    if (isImageError) {
      setIsImageError(false);
    }
  }

  function handleImageError() {
    setIsLoading(false);

    if (!isImageError) {
      setIsImageError(true);
    }
  }

  function handleRetry() {
    setIsImageError(false);
    setIsLoading(true);
    // Force image reload by changing key
    setRetryKey((prev) => prev + 1);
  }

  return (
    <>
      <div
        className={tw(
          "relative size-14 overflow-hidden rounded border",
          className
        )}
      >
        {isLoading ? (
          <div
            className={tw(
              "absolute inset-0 flex items-center justify-center bg-color-100",
              "z-10 transition-opacity"
            )}
          >
            <Spinner className="[&_.spinner]:before:border-t-gray-400" />
          </div>
        ) : null}

        {isImageError && !isLoading ? (
          <div
            className={tw(
              "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2",
              "bg-color-100 text-color-500"
            )}
          >
            <div className="px-2 text-center text-xs">Failed to load</div>
            <button
              type="button"
              onClick={handleRetry}
              className="hover:bg-color-300 flex items-center gap-1 rounded bg-color-200 px-2 py-1 text-xs text-color-700 transition-colors"
              title="Retry loading image"
            >
              <RefreshCwIcon className="size-4" />
              Retry
            </button>
          </div>
        ) : null}

        <img
          onClick={withPreview ? handleOpenDialog : undefined}
          key={retryKey}
          src={
            thumbnailUrl ?? imageUrl ?? "/static/images/asset-placeholder.jpg"
          }
          className={tw(
            "size-full object-cover",
            withPreview && "cursor-pointer"
          )}
          alt={alt}
          loading="lazy"
          onLoad={handleImageLoad}
          onError={handleImageError}
          {...restProps}
        />
      </div>

      {withPreview &&
        (() => {
          const dialogContent = (
            <Dialog
              open={open}
              onClose={handleCloseDialog}
              className="h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-[90%]"
              wrapperClassName="z-[100]"
              title={
                <div>
                  <div className="text-lg font-semibold text-color-900">
                    {currentImage.alt}
                  </div>
                  <div className="text-sm font-normal text-color-600">
                    {hasNavigation
                      ? `${currentIndex + 1} of ${images!.length} image(s)`
                      : "1 image(s)"}
                  </div>
                </div>
              }
            >
              <div
                ref={handleDialogContentMount}
                className="relative z-10 flex h-full flex-col bg-surface shadow-lg md:rounded"
                role="dialog"
                tabIndex={-1}
                onKeyDown={handleKeyDown}
              >
                <div className="relative flex max-h-[calc(100%-4rem)] grow items-center justify-center border-y border-color-200 bg-color-50">
                  {hasNavigation && canGoPrevious && (
                    <button
                      type="button"
                      onClick={handlePrevious}
                      className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-color-900 transition-all hover:text-color-600"
                      aria-label="Previous"
                    >
                      <ChevronRight className="size-8 rotate-180" />
                    </button>
                  )}

                  <img
                    src={currentImage.imageUrl}
                    className="max-h-full"
                    alt={currentImage.alt}
                  />

                  {hasNavigation && canGoNext && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-4 top-1/2 z-10 -translate-y-1/2 text-color-900 transition-all hover:text-color-600"
                      aria-label="Next"
                    >
                      <ChevronRight className="size-8" />
                    </button>
                  )}
                </div>

                <div className="flex w-full justify-center gap-3 px-6 py-3 md:justify-end">
                  {editImageUrl ? (
                    <Button to={editImageUrl} variant="secondary">
                      Edit image(s)
                    </Button>
                  ) : null}

                  <Button variant="secondary" onClick={handleCloseDialog}>
                    Close
                  </Button>
                </div>
              </div>
            </Dialog>
          );

          return disablePortal ? (
            dialogContent
          ) : (
            <DialogPortal>{dialogContent}</DialogPortal>
          );
        })()}
    </>
  );
}
