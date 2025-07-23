import { usePlaceholderImage } from "~/hooks/use-placeholder-image";
import { getDifferenceInSeconds } from "~/utils/date-fns";
import { tw } from "~/utils/tw";

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
  const placeholderImage = usePlaceholderImage();

  return (
    <img
      src={
        imageId
          ? `/api/image/${imageId}${forceReload ? `?t=${Date.now()}` : ""}`
          : placeholderImage
      }
      alt={alt}
      className={tw(className)}
      loading="lazy"
    />
  );
};
