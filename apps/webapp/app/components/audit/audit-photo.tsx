/**
 * Audit photo with the time it was taken
 *
 * Every place the web app shows an audit photo uses these, so each photo
 * carries the same line: "Taken <date and time>" when the photo's EXIF had a
 * date, or "Time taken unknown" when it did not. The unknown case is shown on
 * purpose: a photo with no capture time is exactly the one a reviewer needs to
 * look at twice. The same line appears in the full-size preview.
 *
 * @see {@link file://../../modules/audit/photo-captured-at.server.ts} where
 *   `capturedAt` comes from
 * @see {@link file://../image-with-preview/image-with-preview.tsx}
 */
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { tw } from "~/utils/tw";
import { DateS } from "../shared/date";

/** The fields of an `AuditImage` a photo tile needs. */
export type AuditPhotoImage = {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  /** When the photo was taken; null when unknown. A string once serialized. */
  capturedAt: Date | string | null;
};

/**
 * "Taken <date and time>" or "Time taken unknown".
 *
 * @param props.capturedAt - The photo's `AuditImage.capturedAt`
 */
export function AuditPhotoTaken({
  capturedAt,
}: {
  capturedAt: AuditPhotoImage["capturedAt"];
}) {
  return capturedAt ? (
    <>
      Taken <DateS date={capturedAt} includeTime />
    </>
  ) : (
    <>Time taken unknown</>
  );
}

/**
 * A clickable audit photo thumbnail with its "Taken ..." line under it.
 *
 * @param props.image - The photo to show
 * @param props.images - Every photo in the same group, for previous/next in the
 *   preview; defaults to this photo alone
 * @param props.alt - Alt text, also the preview title
 * @param props.className - Size classes for the thumbnail (and so the tile)
 * @param props.disablePortal - Render the preview inline when already inside a
 *   dialog
 */
export function AuditPhoto({
  image,
  images = [image],
  alt,
  className = "size-24",
  disablePortal,
}: {
  image: AuditPhotoImage;
  images?: AuditPhotoImage[];
  alt: string;
  className?: string;
  disablePortal?: boolean;
}) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <ImageWithPreview
        imageUrl={image.imageUrl}
        thumbnailUrl={image.thumbnailUrl || image.imageUrl}
        alt={alt}
        withPreview
        disablePortal={disablePortal}
        className={tw("rounded border", className)}
        images={images.map((img) => ({
          id: img.id,
          imageUrl: img.imageUrl,
          thumbnailUrl: img.thumbnailUrl || img.imageUrl,
          alt,
          caption: <AuditPhotoTaken capturedAt={img.capturedAt} />,
        }))}
        caption={<AuditPhotoTaken capturedAt={image.capturedAt} />}
        currentImageId={image.id}
      />
      {/* why: the caption may not widen the tile past its thumbnail, so it
          wraps under the photo instead of pushing the row apart */}
      <figcaption className="w-0 min-w-full text-[11px] leading-tight text-gray-600">
        <AuditPhotoTaken capturedAt={image.capturedAt} />
      </figcaption>
    </figure>
  );
}
