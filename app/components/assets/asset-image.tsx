import { useEffect, useState } from "react";
import type { Asset } from "@prisma/client";

import { useFetcher } from "@remix-run/react";
import type { action } from "~/routes/api+/asset.refresh-main-image";
import { tw } from "~/utils/tw";
import { Dialog } from "../layout/dialog";

export const AssetImage = ({
  asset,
  className,
  ...rest
}: {
  asset: {
    assetId: Asset["id"];
    mainImage: Asset["mainImage"];
    mainImageExpiration: Date | string | null;
    alt: string;
  };
  className?: string;
  rest?: HTMLImageElement;
}) => {
  const fetcher = useFetcher<typeof action>();
  const { assetId, mainImage, mainImageExpiration, alt } = asset;
  const updatedAssetMainImage = fetcher.data?.error
    ? null
    : fetcher.data?.asset.mainImage;
  const url =
    mainImage ||
    updatedAssetMainImage ||
    "/static/images/asset-placeholder.jpg";

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  useEffect(() => {
    if (mainImage && mainImageExpiration) {
      const now = new Date();
      const expiration = new Date(mainImageExpiration);
      if (now > expiration) {
        fetcher.submit(
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
  const classes = tw(
    "size-full gap-[10px] rounded bg-gray-50 object-contain p-6"
  );
  return (
    <>
      <img
        onClick={handleOpenDialog}
        src={url}
        className={tw(className)}
        alt={alt}
        {...rest}
      />
      <Dialog
        title={asset.alt}
        open={isDialogOpen}
        onClose={handleCloseDialog}
        noScroll={true}
      >
        <img src={url} className={classes} alt={alt} {...rest} />
      </Dialog>
    </>
  );
};
