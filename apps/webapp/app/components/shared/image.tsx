/**
 * Renders an image stored in the `Image` table, served by `/api/image/:imageId`.
 *
 * That route serves with a year-long `Cache-Control`, and replacing a stored
 * image (e.g. the workspace logo) upserts the SAME row — the id, and with it
 * the bare URL, never changes. The URL therefore carries a stable `?v=`
 * version derived from `updatedAt`: it changes exactly when the stored blob
 * changes, which busts the browser cache on update and keeps it effective the
 * rest of the time.
 *
 * Always pass `updatedAt` (the image's own timestamp, or the owning entity's)
 * for images a user can replace — without it the browser may pin its
 * first-cached copy of the bare URL for up to a year.
 *
 * @see {@link file://../../routes/api+/image.$imageId.ts}
 */
import { tw } from "~/utils/tw";

/**
 * Stored-image renderer. See the file-level doc above for the URL/version
 * contract.
 *
 * @param imageId - `Image` row id; falls back to the placeholder when absent.
 * @param alt - Image alt text.
 * @param className - Extra classes for the `img` element.
 * @param updatedAt - Timestamp of the image (or its owning entity); becomes
 * the `?v=` cache version.
 */
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
  const version = new Date(updatedAt).getTime();
  return (
    <img
      src={
        imageId
          ? `/api/image/${imageId}${
              Number.isNaN(version) ? "" : `?v=${version}`
            }`
          : `/static/images/asset-placeholder.jpg`
      }
      alt={alt}
      className={tw(className)}
      loading="lazy"
    />
  );
};
