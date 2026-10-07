import type { HTMLProps } from "react";
import { useCallback, useReducer } from "react";
import { RefreshCwIcon } from "lucide-react";
import { tw } from "~/utils/tw";
import { ImagePreviewDialog } from "./image-preview-dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

/**
 * Consolidated UI state for ImageWithPreview. A reducer is used here
 * because several transitions update two fields together (e.g. `retry`
 * clears the error flag while bumping the cache-buster key), and grouping
 * them behind explicit actions keeps the dispatch sites readable.
 */
type PreviewState = {
  isLoading: boolean;
  isImageError: boolean;
  retryKey: number;
  open: boolean;
  currentIndex: number;
};

type PreviewAction =
  | { type: "load_success" }
  | { type: "load_error" }
  | { type: "retry" }
  | { type: "open"; index: number }
  | { type: "close" }
  | { type: "set_index"; index: number };

const INITIAL_PREVIEW_STATE: PreviewState = {
  isLoading: true,
  isImageError: false,
  retryKey: 0,
  open: false,
  currentIndex: 0,
};

function previewReducer(
  state: PreviewState,
  action: PreviewAction
): PreviewState {
  switch (action.type) {
    case "load_success":
      return { ...state, isLoading: false, isImageError: false };
    case "load_error":
      return { ...state, isLoading: false, isImageError: true };
    case "retry":
      // Force the underlying <img> to remount by bumping `retryKey` —
      // this re-triggers the browser's image fetch.
      return {
        ...state,
        isImageError: false,
        isLoading: true,
        retryKey: state.retryKey + 1,
      };
    case "open":
      return { ...state, open: true, currentIndex: action.index };
    case "close":
      return { ...state, open: false };
    case "set_index":
      return { ...state, currentIndex: action.index };
    default:
      return state;
  }
}

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
  const [state, dispatch] = useReducer(previewReducer, INITIAL_PREVIEW_STATE);
  const { isLoading, isImageError, retryKey, open, currentIndex } = state;

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
      dispatch({ type: "set_index", index: newIndex });
      if (onNavigate && images) {
        onNavigate(images[newIndex].id);
      }
    }
  }, [canGoPrevious, currentIndex, onNavigate, images]);

  const handleNext = useCallback(() => {
    if (canGoNext) {
      const newIndex = currentIndex + 1;
      dispatch({ type: "set_index", index: newIndex });
      if (onNavigate && images) {
        onNavigate(images[newIndex].id);
      }
    }
  }, [canGoNext, currentIndex, onNavigate, images]);

  function handleOpenDialog() {
    if (!imageUrl) {
      return;
    }
    // Default to the first image; override with `currentImageId` if navigable
    let nextIndex = 0;
    if (images && currentImageId) {
      const found = images.findIndex((img) => img.id === currentImageId);
      if (found !== -1) {
        nextIndex = found;
      }
    }

    dispatch({ type: "open", index: nextIndex });
  }

  function handleCloseDialog() {
    dispatch({ type: "close" });
  }

  function handleImageLoad() {
    dispatch({ type: "load_success" });
  }

  function handleImageError() {
    dispatch({ type: "load_error" });
  }

  function handleRetry() {
    dispatch({ type: "retry" });
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
              "absolute inset-0 flex items-center justify-center bg-gray-100",
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
              "bg-gray-100 text-gray-500"
            )}
          >
            <div className="px-2 text-center text-xs">Failed to load</div>
            <button
              type="button"
              onClick={handleRetry}
              className="flex items-center gap-1 rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-300"
              title="Retry loading image"
            >
              <RefreshCwIcon className="size-4" />
              Retry
            </button>
          </div>
        ) : null}

        <img
          onClick={withPreview ? handleOpenDialog : undefined}
          // When the image acts as a preview trigger, make it keyboard
          // reachable and activatable with Enter or Space.
          onKeyDown={
            withPreview
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleOpenDialog();
                  }
                }
              : undefined
          }
          role={withPreview ? "button" : undefined}
          tabIndex={withPreview ? 0 : undefined}
          aria-label={withPreview ? `Open preview for ${alt}` : undefined}
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

      {withPreview ? (
        <ImagePreviewDialog
          open={open}
          onClose={handleCloseDialog}
          imageUrl={currentImage.imageUrl}
          alt={currentImage.alt}
          subtitle={
            hasNavigation
              ? `${currentIndex + 1} of ${images!.length} image(s)`
              : "1 image(s)"
          }
          onPrevious={canGoPrevious ? handlePrevious : undefined}
          onNext={canGoNext ? handleNext : undefined}
          actions={
            editImageUrl ? (
              <Button to={editImageUrl} variant="secondary">
                Edit image(s)
              </Button>
            ) : undefined
          }
          disablePortal={disablePortal}
        />
      ) : null}
    </>
  );
}
