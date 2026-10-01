/**
 * Full-size image preview
 *
 * The one viewer every image thumbnail in the app opens into: audit photos and
 * anything else rendered through `ImageWithPreview`, asset images and kit
 * images. A photo is shown whole at its own aspect ratio, so a stamp burned
 * into its corner stays readable.
 *
 * Below the `lg` breakpoint (phones and tablets) it is a full-screen black
 * overlay: the image is as large as the screen allows, the close button sits
 * inside the safe area, a tap anywhere around the image closes it, and the
 * page behind does not scroll. From `lg` up the same markup lays out as a
 * centred panel with a title bar and a footer over the dimmed page.
 *
 * Escape closes it. With `onPrevious` / `onNext`, the arrow keys page through.
 *
 * @see {@link file://./image-with-preview.tsx}
 * @see {@link file://../assets/asset-image/component.tsx}
 * @see {@link file://../kits/kit-image.tsx}
 */
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { ChevronRight, XIcon } from "~/components/icons/library";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { DIALOG_CLOSE_SHORTCUT } from "~/utils/constants";
import { tw } from "~/utils/tw";
import { DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/** Props of {@link ImagePreviewDialog}. */
type ImagePreviewDialogProps = {
  /** Whether the preview is showing. */
  open: boolean;
  /** Called by the close button, a tap around the image and Escape. */
  onClose: () => void;
  /** The full-size image. Never pass a thumbnail. */
  imageUrl: string;
  /** Alt text of the image; also the heading when `title` is not given. */
  alt: string;
  /** Heading above the image. */
  title?: ReactNode;
  /** Line under the heading, such as "2 of 3 image(s)". */
  subtitle?: ReactNode;
  /** Shows a "Previous" control and binds the left arrow key. */
  onPrevious?: () => void;
  /** Shows a "Next" control and binds the right arrow key. */
  onNext?: () => void;
  /** Extra actions for the footer, such as an "Edit image(s)" link. */
  actions?: ReactNode;
  /** Render in place rather than portaled to `body` (inside another dialog). */
  disablePortal?: boolean;
};

/**
 * Shows one image full-size over the page.
 *
 * @param props - See {@link ImagePreviewDialogProps}
 */
export function ImagePreviewDialog({
  open,
  disablePortal = false,
  ...overlayProps
}: ImagePreviewDialogProps) {
  if (!open) return null;

  const overlay = <PreviewOverlay {...overlayProps} />;
  return disablePortal ? overlay : <DialogPortal>{overlay}</DialogPortal>;
}

/**
 * The open preview. Mounted only while open, so the scroll lock, the key
 * bindings and the focus move are taken on open and released on close.
 */
function PreviewOverlay({
  onClose,
  imageUrl,
  alt,
  title,
  subtitle,
  onPrevious,
  onNext,
  actions,
}: Omit<ImagePreviewDialogProps, "open" | "disablePortal">) {
  const closeButtonRef = useAutoFocus<HTMLButtonElement>();

  // Read through a ref so the listener below is bound once per opening.
  const handlersRef = useRef({ onClose, onPrevious, onNext });
  handlersRef.current = { onClose, onPrevious, onNext };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      const handlers = handlersRef.current;
      if (event.key === DIALOG_CLOSE_SHORTCUT) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onClose();
      } else if (event.key === "ArrowLeft" && handlers.onPrevious) {
        event.preventDefault();
        handlers.onPrevious();
      } else if (event.key === "ArrowRight" && handlers.onNext) {
        event.preventDefault();
        handlers.onNext();
      }
    }

    // Capture on `window`, like `Dialog`: it runs before an enclosing
    // overlay's own Escape handler.
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  /** Closes only when the tap landed on the element itself, not a child. */
  function closeOnOwnClick(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  // The backdrop and the stage around the image close on a tap. They are a
  // pointer shortcut only, so they stay presentational: keyboard users close
  // with Escape or the close button, which takes focus on open.
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain bg-gray-950 lg:bg-black/50 lg:p-8 lg:backdrop-blur-sm"
      onClick={closeOnOwnClick}
      data-image-preview-backdrop
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        className="relative flex size-full flex-col lg:w-[90%] lg:overflow-hidden lg:rounded lg:bg-white lg:shadow-lg"
        onClick={closeOnOwnClick}
      >
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white lg:static lg:border-b lg:border-gray-200 lg:bg-white lg:bg-none lg:px-6 lg:py-3 lg:text-gray-900">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold lg:text-lg">
              {title ?? alt}
            </div>
            {subtitle ? (
              <div className="text-sm text-white/80 lg:text-gray-600">
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 lg:size-9 lg:bg-transparent lg:text-gray-500 lg:hover:bg-gray-100"
          >
            <XIcon />
          </button>
        </div>

        <div
          role="presentation"
          className="relative flex min-h-0 grow items-center justify-center lg:bg-gray-50"
          onClick={closeOnOwnClick}
          data-image-preview-stage
        >
          <img
            src={imageUrl}
            alt={alt}
            className="max-h-dvh max-w-[100vw] object-contain lg:max-h-full lg:max-w-full"
          />

          {onPrevious ? (
            <button
              type="button"
              onClick={onPrevious}
              aria-label="Previous"
              className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white lg:left-4 lg:bg-transparent lg:text-gray-900 lg:hover:text-gray-600"
            >
              <ChevronRight className="size-8 rotate-180" />
            </button>
          ) : null}
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              aria-label="Next"
              className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white lg:right-4 lg:bg-transparent lg:text-gray-900 lg:hover:text-gray-600"
            >
              <ChevronRight className="size-8" />
            </button>
          ) : null}
        </div>

        <div
          className={tw(
            "absolute inset-x-0 bottom-0 z-10 items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8",
            "lg:static lg:flex lg:justify-end lg:border-t lg:border-gray-200 lg:bg-white lg:bg-none lg:px-6 lg:py-3",
            actions ? "flex" : "hidden"
          )}
        >
          {actions}
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="hidden lg:inline-flex"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
