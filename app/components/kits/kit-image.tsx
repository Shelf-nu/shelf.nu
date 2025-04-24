import type { ImgHTMLAttributes } from "react";
import { useEffect, useState } from "react";
import type { Kit } from "@prisma/client";
import { useFetcher } from "@remix-run/react";
import type { action } from "~/routes/api+/kit.refresh-image";
import { tw } from "~/utils/tw";
import { DIALOG_CLOSE_SHORTCUT } from "../assets/asset-image/component";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

type KitImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  className?: string;
  kit: {
    kitId: Kit["id"];
    image: Kit["image"];
    imageExpiration: Kit["imageExpiration"] | string;
    alt: string;
  };
  withPreview?: boolean;
};

export default function KitImage({
  className,
  kit,
  withPreview = false,
  ...rest
}: KitImageProps) {
  const fetcher = useFetcher<typeof action>();

  const { kitId, image, imageExpiration, alt } = kit;

  const updatedKitImage = fetcher.data?.error ? null : fetcher.data?.kit.image;
  const [isLoading, setIsLoading] = useState(true);
  const handleImageLoad = () => {
    setIsLoading(false);
  };
  const url =
    image ?? updatedKitImage ?? "/static/images/asset-placeholder.jpg";

  useEffect(function refreshImageIfExpired() {
    if (image && imageExpiration) {
      const now = new Date();
      const expiration = new Date(imageExpiration);
      if (now > expiration) {
        fetcher.submit(
          { kitId, image },
          {
            method: "post",
            action: "/api/kit/refresh-image",
          }
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };
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
        {isLoading && (
          <div
            className={tw(
              "absolute inset-0 flex items-center justify-center bg-gray-100",
              "transition-opacity" // Fallback animation
            )}
          >
            <Spinner className="[&_.spinner]:before:border-t-gray-400" />
          </div>
        )}

        <img
          onClick={withPreview ? handleOpenDialog : undefined}
          src={url}
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
                <div className=" text-lg font-semibold text-gray-900">
                  {kit.alt}
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
                <img src={url} className={"max-h-full"} alt={alt} />
              </div>
              <div className="flex w-full justify-center gap-3 px-6 py-3 md:justify-end">
                <Button to={`/kits/${kitId}/edit`} variant="secondary">
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
}
