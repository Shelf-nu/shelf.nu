import { tw } from "~/utils";
import { getDifferenceInSeconds } from "~/utils/date-fns";

const FORCE_RELOAD_WITHIN_SECONDS = 30;
export const Image = ({
  imageId,
  alt,
  className,
  updatedAt = "",
}: {
  imageId?: string | null;
  alt: string;
  className?: string;
  updatedAt?: Date | string | number;
}) => {
  const imageUpdatedAt = new Date(updatedAt);
  const imageUpdatedAtDiff = getDifferenceInSeconds(imageUpdatedAt, new Date());
  // @NOTE: force reload the image, if image is updated with last 30 seconds.
  const forceReload = imageUpdatedAtDiff < FORCE_RELOAD_WITHIN_SECONDS;
  return (
    <img
      src={
        imageId
          ? `/api/image/${imageId}${forceReload ? `?t=${Date.now()}` : ""}`
          : `/images/asset-placeholder.jpg`
      }
      alt={alt}
      className={tw(className)}
      loading="lazy"
    />
  );
};
