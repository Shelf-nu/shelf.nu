import { useEffect } from "react";
import type { Asset } from "@prisma/client";

import { useFetcher } from "@remix-run/react";
import { tw } from "~/utils";

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
  const fetcher = useFetcher();
  const { assetId, mainImage, mainImageExpiration, alt } = asset;
  const url =
    mainImage || fetcher?.data?.mainImage || "/images/asset-placeholder.png";

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

  return <img src={url} className={tw(className)} alt={alt} {...rest} />;
};
