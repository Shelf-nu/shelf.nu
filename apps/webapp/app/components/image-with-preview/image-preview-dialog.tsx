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
 * Built on the Radix dialog primitive, like the app's sheets. That is what
 * keeps it usable when it opens from inside a sheet: Radix stacks the two
 * focus scopes and dismissal layers, so focus, Escape and outside taps belong
 * to the preview while it is open and return to the sheet when it closes.
 * Escape closes it, Tab stays inside it, and with `onPrevious` / `onNext` the
 * arrow keys page through.
 *
 * @see {@link file://./image-with-preview.tsx}
 * @see {@link file://../assets/asset-image/component.tsx}
 * @see {@link file://../kits/kit-image.tsx}
 * @see {@link file://../shared/sheet.tsx} the sheets it may open from
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, XIcon } from "~/components/icons/library";
import { tw } from "~/utils/tw";
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
  onClose,
  disablePortal = false,
  ...panelProps
}: ImagePreviewDialogProps) {
  const layers = <PreviewLayers onClose={onClose} {...panelProps} />;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {disablePortal ? (
        layers
      ) : (
        <DialogPrimitive.Portal>{layers}</DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}

/** The dimmed backdrop and the panel holding the image. */
function PreviewLayers({
  onClose,
  imageUrl,
  alt,
  title,
  subtitle,
  onPrevious,
  onNext,
  actions,
}: Omit<ImagePreviewDialogProps, "open" | "disablePortal">) {
  /** Closes only when the tap landed on the element itself, not a child. */
  function closeOnOwnClick(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" && onPrevious) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === "ArrowRight" && onNext) {
      event.preventDefault();
      onNext();
    }
  }

  return (
    <>
      {/* Visible only around the panel from `lg` up; Radix closes the preview
          on a tap here. `pointer-events-auto` keeps it tappable under a modal
          sheet, which sets `pointer-events: none` on <body>.
          `data-image-preview-backdrop` marks it as a dialog for the sheets that
          check before closing (see `contextual-sidebar.tsx`). */}
      <DialogPrimitive.Overlay
        className="pointer-events-auto fixed inset-0 z-[100] bg-gray-950 lg:bg-black/50 lg:backdrop-blur-sm"
        data-image-preview-backdrop
      />
      {/* The stage around the image closes on a tap too. That is a pointer
          shortcut only: keyboard users close with Escape or the close button,
          which Radix focuses on open. */}
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onKeyDown={handleKeyDown}
        onClick={closeOnOwnClick}
        className="fixed inset-0 z-[100] flex flex-col focus:outline-none lg:inset-x-[5%] lg:inset-y-8 lg:overflow-hidden lg:rounded lg:bg-white lg:shadow-lg"
      >
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white lg:static lg:border-b lg:border-gray-200 lg:bg-white lg:bg-none lg:px-6 lg:py-3 lg:text-gray-900">
          <div className="min-w-0">
            {/* Colour set here, not inherited: the global `h2` style would
                paint it dark on the black phone overlay. */}
            <DialogPrimitive.Title className="truncate text-base font-semibold text-white lg:text-lg lg:text-gray-900">
              {title ?? alt}
            </DialogPrimitive.Title>
            {subtitle ? (
              <div className="text-sm text-white/80 lg:text-gray-600">
                {subtitle}
              </div>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close preview"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 lg:size-9 lg:bg-transparent lg:text-gray-500 lg:hover:bg-gray-100"
          >
            <XIcon />
          </DialogPrimitive.Close>
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
      </DialogPrimitive.Content>
    </>
  );
}
