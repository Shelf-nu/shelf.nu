import { useState } from "react";
import { tw } from "~/utils/tw";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type ImageWithPreviewProps = {
  className?: string;
  imageUrl?: string;
  thumbnailUrl: string | null | undefined;
  withPreview?: boolean;
  alt: string;
  editImageUrl?: string;
} & React.HTMLProps<HTMLImageElement>;

export default function ImageWithPreview({
  className,
  imageUrl,
  thumbnailUrl,
  withPreview = false,
  alt,
  editImageUrl,
  ...restProps
}: ImageWithPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isImageError, setIsImageError] = useState(false);

  const [open, setOpen] = useState(false);

  function handleOpenDialog() {
    if (!imageUrl) {
      return;
    }

    setOpen(true);
  }

  function handleCloseDialog() {
    setOpen(false);
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

        <img
          onClick={withPreview ? handleOpenDialog : undefined}
          src={thumbnailUrl ?? "/static/images/asset-placeholder.jpg"}
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

      {withPreview && (
        <DialogPortal>
          <Dialog
            open={open}
            onClose={handleCloseDialog}
            className="h-[90vh] w-full p-0 md:h-[calc(100vh-4rem)] md:w-[90%]"
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
                <img src={imageUrl} className="max-h-full" alt={alt} />
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
        </DialogPortal>
      )}
    </>
  );
}
