import { useEffect } from "react";
import type { Item } from "@prisma/client";

import { useFetcher } from "@remix-run/react";
import { tw } from "~/utils";

export const ItemImage = ({
  item,
  className,
  ...rest
}: {
  item: {
    itemId: Item["id"];
    mainImage: Item["mainImage"];
    mainImageExpiration: Date;
    alt: string;
  };
  className?: string;
  rest?: HTMLImageElement;
}) => {
  const fetcher = useFetcher();
  const { itemId, mainImage, mainImageExpiration, alt } = item;
  const url =
    mainImage || fetcher?.data?.mainImage || "/images/item-placeholder.png";

  useEffect(() => {
    if (mainImage) {
      const now = new Date();
      const expiration = new Date(mainImageExpiration);

      if (now > expiration) {
        fetcher.submit(
          { itemId, mainImage: mainImage || "" },
          {
            method: "post",
            action: "/api/item/refresh-main-image",
          }
        );
      }
    }
  });

  return <img src={url} className={tw(className)} alt={alt} {...rest} />;
};
