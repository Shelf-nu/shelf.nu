import { tw } from "~/utils";

export const Image = ({
  imageId,
  alt,
  className,
}: {
  imageId?: string | null;
  alt: string;
  className?: string;
}) => (
  <img
    src={imageId ? `/api/image/${imageId}` : `/images/asset-placeholder.jpg`}
    alt={alt}
    className={tw(className)}
  />
);
