/**
 * Audit photo with how it arrived and when it was taken
 *
 * Every place the web app shows an audit photo uses these, so each photo
 * carries the same two lines: how it reached Shelf ("Taken in the app", "From
 * the photo library", "Uploaded on the web") and when it was taken, or "Time
 * taken unknown". The wording comes from `describeAuditPhotoTime` in
 * `@shelf/labels`, which the companion app uses too. The same lines appear in
 * the full-size preview and in the receipt PDF.
 *
 * @see {@link file://../../modules/audit/photo-captured-at.server.ts} where
 *   `capturedAt` and `captureSource` come from
 * @see {@link file://../image-with-preview/image-with-preview.tsx}
 */
import type { AuditPhotoCaptureSource } from "@shelf/labels";
import { describeAuditPhotoTime } from "@shelf/labels";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { tw } from "~/utils/tw";

/** The fields of an `AuditImage` a photo tile needs. */
export type AuditPhotoImage = {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  /** When the photo was taken; null when unknown. A string once serialized. */
  capturedAt: Date | string | null;
  /** How the photo reached Shelf; null when unknown. */
  captureSource?: AuditPhotoCaptureSource | null;
  /** When it was uploaded; shown for a camera photo with no capture time. */
  createdAt?: Date | string | null;
};

/**
 * How the photo arrived, then when it was taken, as one line or two.
 *
 * @param props.image - The photo's capture fields
 * @param props.inline - One line joined by a dot (preview title), instead of
 *   one line per fact (under a thumbnail)
 */
export function AuditPhotoTaken({
  image,
  inline = false,
}: {
  image: Pick<AuditPhotoImage, "capturedAt" | "captureSource" | "createdAt">;
  inline?: boolean;
}) {
  const { formatDateTime } = useDateFormatter();
  const { source, time } = describeAuditPhotoTime(image, formatDateTime);

  if (inline) {
    return <>{source ? `${source} · ${time}` : time}</>;
  }
  return (
    <>
      {source ? <span className="block">{source}</span> : null}
      <span className="block">{time}</span>
    </>
  );
}

/**
 * A clickable audit photo thumbnail with its source and time under it.
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
          caption: <AuditPhotoTaken image={img} inline />,
        }))}
        caption={<AuditPhotoTaken image={image} inline />}
        currentImageId={image.id}
      />
      {/* why: the caption may not widen the tile past its thumbnail, so it
          wraps under the photo instead of pushing the row apart */}
      <figcaption className="w-0 min-w-full text-[11px] leading-tight text-gray-600">
        <AuditPhotoTaken image={image} />
      </figcaption>
    </figure>
  );
}
