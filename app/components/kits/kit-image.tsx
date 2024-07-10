import type { ImgHTMLAttributes } from "react";
import { useEffect } from "react";
import type { Kit } from "@prisma/client";
import { useFetcher } from "@remix-run/react";
import type { action } from "~/routes/api+/kit.refresh-image";
import { tw } from "~/utils/tw";

type KitImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  className?: string;
  kit: {
    kitId: Kit["id"];
    image: Kit["image"];
    imageExpiration: Kit["imageExpiration"] | string;
    alt: string;
  };
};

export default function KitImage({
  className,
  kit,
  ...imageProps
}: KitImageProps) {
  const fetcher = useFetcher<typeof action>();

  const { kitId, image, imageExpiration, alt } = kit;

  const updatedKitImage = fetcher.data?.error ? null : fetcher.data?.kit.image;

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

  return <img {...imageProps} src={url} className={tw(className)} alt={alt} />;
}
