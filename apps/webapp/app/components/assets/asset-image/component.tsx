import { useEffect, useReducer, useState, useCallback, useRef } from "react";

import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import { DIALOG_CLOSE_SHORTCUT } from "~/utils/constants";
import { tw } from "~/utils/tw";
import type { AssetImageProps } from "./types";
import { isAssetForPreview } from "./utils";
// Import the debug helper (uncomment during debugging)
// import { debugImageUrl } from "~/utils/debug-helpers";

/**
 * Shape returned by the `refresh-main-image` and `generate-thumbnail` resource
 * routes. Both wrap their result in `payload(...)`, which always injects an
 * `error` key (`null` on success) and these routes always include an `asset`
 * key (`null` when the asset is missing/deleted). The nested image fields are
 * optional because the route's `select` varies by path.
 */
type AssetImageApiResponse = {
  asset: {
    id: string;
    mainImage?: string | null;
    thumbnailImage?: string | null;
  } | null;
  error: string | null;
};

/**
 * Consolidated UI + data state for AssetImage. Grouped in a reducer because
 * several of these transitions are triggered together (e.g. `load_success`
 * flips both `isLoading` and `isImageError`), so expressing them as explicit
 * actions makes the flow easier to reason about than many separate useState
 * setters. The background-fetch results (`refreshedMainImage`,
 * `refreshedThumbnailImage`) live here too so a settled request updates the
 * rendered URL atomically with clearing the in-flight flag.
 */
type AssetImageState = {
  isLoading: boolean;
  isImageError: boolean;
  isDialogOpen: boolean;
  hasAttemptedRefresh: boolean;
  /** True while a background refresh / thumbnail request is in flight. */
  isFetchingImage: boolean;
  /** Fresh main-image URL returned by the refresh endpoint, if any. */
  refreshedMainImage: string | null;
  /** Fresh thumbnail URL returned by the refresh or generate endpoint, if any. */
  refreshedThumbnailImage: string | null;
};

type AssetImageAction =
  | { type: "load_success" }
  | { type: "load_error" }
  | { type: "clear_error" }
  | { type: "asset_changed" }
  | { type: "mark_refresh_attempted" }
  | { type: "open_dialog" }
  | { type: "close_dialog" }
  | { type: "fetch_start" }
  | { type: "fetch_settled" }
  | {
      type: "image_refreshed";
      mainImage: string | null;
      thumbnailImage: string | null;
    }
  | { type: "thumbnail_generated"; thumbnailImage: string | null };

const INITIAL_ASSET_IMAGE_STATE: AssetImageState = {
  isLoading: true,
  isImageError: false,
  isDialogOpen: false,
  hasAttemptedRefresh: false,
  isFetchingImage: false,
  refreshedMainImage: null,
  refreshedThumbnailImage: null,
};

function assetImageReducer(
  state: AssetImageState,
  action: AssetImageAction
): AssetImageState {
  switch (action.type) {
    case "load_success":
      return { ...state, isLoading: false, isImageError: false };
    case "load_error":
      return { ...state, isLoading: false, isImageError: true };
    case "clear_error":
      return { ...state, isImageError: false };
    case "asset_changed":
      // The rendered asset changed under a reused component instance — drop the
      // previous asset's refreshed URLs and in-flight/error flags so we never
      // show a stale image or skip the new asset's refresh/generation.
      return {
        ...state,
        isLoading: true,
        isImageError: false,
        isFetchingImage: false,
        hasAttemptedRefresh: false,
        refreshedMainImage: null,
        refreshedThumbnailImage: null,
      };
    case "mark_refresh_attempted":
      return { ...state, hasAttemptedRefresh: true };
    case "open_dialog":
      return { ...state, isDialogOpen: true };
    case "close_dialog":
      return { ...state, isDialogOpen: false };
    case "fetch_start":
      return { ...state, isFetchingImage: true };
    case "fetch_settled":
      return { ...state, isFetchingImage: false };
    case "image_refreshed":
      return {
        ...state,
        isFetchingImage: false,
        // A successful refresh means we have valid new URLs — clear any prior
        // error so the freshly-signed image is shown. Check for `null`
        // explicitly (the fields are `string | null`) rather than truthiness.
        isImageError:
          action.mainImage != null || action.thumbnailImage != null
            ? false
            : state.isImageError,
        refreshedMainImage: action.mainImage ?? state.refreshedMainImage,
        refreshedThumbnailImage:
          action.thumbnailImage ?? state.refreshedThumbnailImage,
      };
    case "thumbnail_generated":
      return {
        ...state,
        isFetchingImage: false,
        refreshedThumbnailImage:
          action.thumbnailImage ?? state.refreshedThumbnailImage,
      };
    default:
      return state;
  }
}

export const AssetImage = ({
  asset,
  className,
  withPreview = false,
  useThumbnail = true,
  alt,
  ...rest
}: AssetImageProps) => {
  const [state, dispatch] = useReducer(
    assetImageReducer,
    INITIAL_ASSET_IMAGE_STATE
  );
  const {
    isLoading,
    isImageError,
    isDialogOpen,
    hasAttemptedRefresh,
    isFetchingImage,
    refreshedMainImage,
    refreshedThumbnailImage,
  } = state;

  // Track if we've already tried refreshing to prevent loops.
  // The ref is the authoritative guard (readable from stale closures);
  // the `hasAttemptedRefresh` state drives the cache-buster in render.
  const hasAttemptedRefreshRef = useRef(false);

  const { id: assetId, thumbnailImage } = asset;

  // Tracks which asset this instance last rendered, so the mount/refresh effect
  // can detect an asset swap (instance reuse) and reset its per-asset guards.
  const previousAssetIdRef = useRef(assetId);

  // Safely access main image properties using the type guard
  const hasMainImageData = "mainImage" in asset && asset.mainImage != null;
  const isPreviewAsset = isAssetForPreview(asset);

  // Extract main image data when available
  const mainImage = hasMainImageData ? asset.mainImage : null;
  const mainImageExpiration = isPreviewAsset ? asset.mainImageExpiration : null;

  // Choose the appropriate image URL with fallbacks
  // Create a stable cache-busting key that won't change on re-renders
  const [cacheBuster] = useState(isImageError ? `?t=${Date.now()}` : "");

  // Prefer a freshly-refreshed URL, falling back to the prop value. Use nullish
  // coalescing (not `||`) so only `null` falls back, matching the
  // `string | null` contract of these fields.
  const currentThumbnail = refreshedThumbnailImage ?? thumbnailImage;
  const currentMainImage = refreshedMainImage ?? mainImage;

  // Only add cache-buster if we've had an error and attempted refresh
  const imageUrl =
    (useThumbnail && currentThumbnail
      ? currentThumbnail
      : currentMainImage || "/static/images/asset-placeholder.jpg") +
    (hasAttemptedRefresh && isImageError ? cacheBuster : "");

  // For preview dialog, also add cache buster only when needed
  const previewImageUrl =
    (currentMainImage || "/static/images/asset-placeholder.jpg") +
    (hasAttemptedRefresh && isImageError ? cacheBuster : "");

  /**
   * Refreshes the asset's signed main-image (and thumbnail) URLs.
   *
   * Uses a native `fetch` rather than a React Router data fetcher on purpose:
   * a data fetcher issues a single-fetch `.data` request, and any non-OK
   * response (e.g. a 429 from the per-path loader rate-limiter) is decoded as a
   * failed data response that bubbles to the route error boundary — crashing
   * the whole index. A native request lets us swallow failures locally and keep
   * showing the existing image. Guarded by `hasAttemptedRefreshRef` so it runs
   * at most once per mount (no retry storms).
   *
   * @param signal - Optional abort signal. When the rendered asset changes the
   *   mount effect aborts the prior request and ignores its result, so a stale
   *   in-flight response can never overwrite state with the previous asset's URLs.
   */
  const refreshImage = useCallback(
    async (signal?: AbortSignal) => {
      if (!assetId || !mainImage || hasAttemptedRefreshRef.current) {
        return;
      }
      hasAttemptedRefreshRef.current = true;
      dispatch({ type: "mark_refresh_attempted" });
      dispatch({ type: "fetch_start" });

      try {
        const params = new URLSearchParams({ assetId, mainImage });
        const response = await fetch(
          `/api/asset/refresh-main-image?${params.toString()}`,
          { signal }
        );

        // The asset changed mid-flight — drop this response entirely so it can't
        // apply the previous asset's URLs.
        if (signal?.aborted) {
          return;
        }

        // why: a non-OK status (rate limit, transient 5xx) must never crash the
        // surrounding UI — keep the existing image and stop.
        if (!response.ok) {
          dispatch({ type: "fetch_settled" });
          return;
        }

        const json = (await response.json()) as AssetImageApiResponse;
        if (signal?.aborted) {
          return;
        }
        dispatch({
          type: "image_refreshed",
          mainImage: json?.asset?.mainImage ?? null,
          thumbnailImage: json?.asset?.thumbnailImage ?? null,
        });
      } catch {
        // Network error / aborted request — degrade gracefully, no crash. Skip
        // the settle dispatch when aborted: the instance moved on / unmounted.
        if (!signal?.aborted) {
          dispatch({ type: "fetch_settled" });
        }
      }
    },
    [assetId, mainImage]
  );

  /**
   * Generates (or re-signs) the asset's thumbnail.
   *
   * Same native-`fetch` rationale as {@link refreshImage}: this endpoint is the
   * one that 429s after a large import, and routing it through a React Router
   * fetcher is what crashed the index. Guarded to run at most once per mount.
   *
   * @param signal - Optional abort signal; see {@link refreshImage}. Prevents a
   *   stale in-flight response from setting a thumbnail for the wrong asset.
   */
  const generateThumbnail = useCallback(
    async (signal?: AbortSignal) => {
      if (!assetId || hasAttemptedRefreshRef.current) {
        return;
      }
      hasAttemptedRefreshRef.current = true;
      dispatch({ type: "mark_refresh_attempted" });
      dispatch({ type: "fetch_start" });

      try {
        const params = new URLSearchParams({ assetId });
        const response = await fetch(
          `/api/asset/generate-thumbnail?${params.toString()}`,
          { signal }
        );

        if (signal?.aborted) {
          return;
        }

        // why: swallow rate-limit / error responses so the index never crashes.
        if (!response.ok) {
          dispatch({ type: "fetch_settled" });
          return;
        }

        const json = (await response.json()) as AssetImageApiResponse;
        if (signal?.aborted) {
          return;
        }
        dispatch({
          type: "thumbnail_generated",
          thumbnailImage: json?.asset?.thumbnailImage ?? null,
        });
      } catch {
        if (!signal?.aborted) {
          dispatch({ type: "fetch_settled" });
        }
      }
    },
    [assetId]
  );

  const handleImageLoad = () => {
    // Successfully loaded, clear both loading and error states
    dispatch({ type: "load_success" });
  };

  const handleImageError = () => {
    // Only set error state and trigger refresh once
    if (!isImageError && !hasAttemptedRefreshRef.current) {
      dispatch({ type: "load_error" });
      void refreshImage();
    } else {
      dispatch({ type: "load_error" });
    }
  };

  const handleOpenDialog = () => {
    dispatch({ type: "open_dialog" });
  };

  const handleCloseDialog = () => {
    dispatch({ type: "close_dialog" });
  };

  // Check for image expiration and generate the thumbnail. Keyed on `assetId`
  // (not `[]`) so that if this component instance is reused for a different
  // asset — i.e. rendered without a stable `key` — we reset the per-asset
  // guards and re-run the refresh/generation for the new asset instead of
  // showing the previous one's image.
  useEffect(() => {
    // When the asset actually changes (not the initial mount), clear the
    // one-shot guard and the previously-refreshed URLs before scheduling work.
    if (previousAssetIdRef.current !== assetId) {
      previousAssetIdRef.current = assetId;
      hasAttemptedRefreshRef.current = false;
      dispatch({ type: "asset_changed" });
    }

    // Stagger refresh requests with a random delay to avoid
    // overwhelming Supabase with concurrent requests (429 errors)
    const timerIds: ReturnType<typeof setTimeout>[] = [];
    const jitter = Math.random() * 3000;

    // Aborts the in-flight request when the asset changes or the component
    // unmounts, so a stale response can't apply the previous asset's URLs.
    const controller = new AbortController();

    // Check for expiration
    if (withPreview && mainImage && mainImageExpiration) {
      try {
        const now = new Date();
        const expiration = new Date(mainImageExpiration);
        // Only refresh if it's actually expired and we haven't tried yet
        if (now > expiration && !hasAttemptedRefreshRef.current) {
          timerIds.push(
            setTimeout(() => {
              void refreshImage(controller.signal);
            }, jitter)
          );
        }
      } catch (e) {
        // If date parsing fails, don't refresh
        // eslint-disable-next-line no-console
        console.error("Error parsing expiration date", e);
      }
    }

    // Generate thumbnail if needed and we haven't tried yet. The
    // `hasAttemptedRefreshRef` guard (reset above on asset change) prevents
    // duplicate generation, so we don't also gate on `refreshedThumbnailImage`
    // here (its closure value would be stale right after an asset_changed reset).
    if (
      useThumbnail &&
      mainImage &&
      !thumbnailImage &&
      !hasAttemptedRefreshRef.current
    ) {
      timerIds.push(
        setTimeout(() => {
          void generateThumbnail(controller.signal);
        }, jitter)
      );
    }

    return () => {
      controller.abort();
      timerIds.forEach((id) => clearTimeout(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]); // Re-run when the rendered asset changes

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
          (useThumbnail && isFetchingImage && !thumbnailImage)) && (
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
            className="h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:p-0"
            title={
              <div>
                <div className="text-lg font-semibold text-gray-900">{alt}</div>
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
                <Button to={`/assets/${assetId}/edit`} variant="secondary">
                  Edit image(s)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCloseDialog}
                >
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
