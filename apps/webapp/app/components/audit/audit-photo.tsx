/**
 * Audit photo tile, its flag and its preview line
 *
 * Every place the web app shows an audit photo uses these, so a reviewer reads
 * every photo the same way. A photo that is fine stays quiet: an icon for how
 * it reached Shelf (Shelf app camera, photo library, web upload) and a short
 * date and time. Only a photo that needs a second look gets a chip: "Old
 * photo" when it was taken more than a day before its asset was scanned (or,
 * for a photo of the whole audit, before the audit started), "No date" when it
 * carries no time. The full sentence ("Photo library · file says 1 Oct 2026,
 * 08:30 · 27 days before this asset was scanned") is in the preview and the
 * tooltip. Photos from before capture times were read show their upload time.
 *
 * The wording and the rules come from `describeAuditPhoto` in `@shelf/labels`,
 * which the receipt PDF and the companion app use too.
 *
 * @see {@link file://../../modules/audit/photo-captured-at.server.ts} where
 *   `capturedAt` and `captureSource` come from
 * @see {@link file://../image-with-preview/image-with-preview.tsx}
 */
import type {
  AuditPhotoCaptureSource,
  AuditPhotoDescription,
} from "@shelf/labels";
import { describeAuditPhoto } from "@shelf/labels";
import {
  CameraIcon,
  GlobeIcon,
  ImagesIcon,
  SmartphoneIcon,
} from "lucide-react";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { tw } from "~/utils/tw";
import { Badge } from "../shared/badge";

/** The fields of an `AuditImage` a photo tile needs. */
export type AuditPhotoImage = {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  /** When the photo was taken; null when unknown. A string once serialized. */
  capturedAt: Date | string | null;
  /** How the photo reached Shelf; null when unknown. */
  captureSource?: AuditPhotoCaptureSource | null;
  /** When it was uploaded; stands in for a camera photo with no capture time. */
  createdAt?: Date | string | null;
  /** The photo's audited asset, when the query carries it, for its scan time */
  auditAsset?: { scannedAt?: Date | string | null } | null;
};

/**
 * What a photo is checked against: when its asset was scanned (from the photo
 * itself, or from the list it sits in) and when its audit started.
 */
export type AuditPhotoCheck = {
  /** When the photo's asset was scanned; null for a photo of the whole audit */
  assetScannedAt?: Date | string | null;
  auditStartedAt?: Date | string | null;
};

/** The icon for each way a photo reaches Shelf. */
const SOURCE_ICONS = {
  CAMERA: CameraIcon,
  LIBRARY: ImagesIcon,
  WEB_UPLOAD: GlobeIcon,
  PHONE: SmartphoneIcon,
} as const;

/** Flag chip colours: amber for "check this", gray for "nothing to go on". */
const FLAG_COLORS = {
  OLD_PHOTO: BADGE_COLORS.amber,
  NO_DATE: BADGE_COLORS.gray,
} as const;

/**
 * Describes a photo in the viewer's own date and time format.
 *
 * @param image - The photo's capture fields
 * @param check - When its asset was scanned and its audit started; the
 *   photo's own `auditAsset.scannedAt` wins when the query carried it
 * @returns What to show for the photo
 */
export function useAuditPhotoDescription(
  image: Pick<
    AuditPhotoImage,
    "capturedAt" | "captureSource" | "createdAt" | "auditAsset"
  >,
  check: AuditPhotoCheck
): AuditPhotoDescription {
  const { formatDate, formatDateTime } = useDateFormatter();
  return describeAuditPhoto(image, {
    assetScannedAt: image.auditAsset?.scannedAt ?? check.assetScannedAt,
    auditStartedAt: check.auditStartedAt,
    format: {
      dateTime: (value) => formatDateTime(value),
      custom: (value, options) => formatDate(value, options),
    },
  });
}

/**
 * The chip a photo carries when it needs a second look, or nothing.
 *
 * @param props.description - From {@link useAuditPhotoDescription}
 */
export function AuditPhotoFlag({
  description,
}: {
  description: AuditPhotoDescription;
}) {
  if (!description.flag || !description.flagLabel) return null;
  const colors = FLAG_COLORS[description.flag];
  return (
    <Badge
      color={colors.bg}
      textColor={colors.text}
      withDot={false}
      className="whitespace-nowrap"
    >
      {description.flagLabel}
    </Badge>
  );
}

/**
 * The icon for how the photo reached Shelf, or nothing for an older photo.
 *
 * @param props.description - From {@link useAuditPhotoDescription}
 * @param props.className - Size classes
 */
export function AuditPhotoSourceIcon({
  description,
  className = "size-3",
}: {
  description: AuditPhotoDescription;
  className?: string;
}) {
  if (!description.source) return null;
  const Icon = SOURCE_ICONS[description.source];
  return (
    <Icon
      className={tw("shrink-0", className)}
      aria-label={description.sourceLabel ?? undefined}
    />
  );
}

/**
 * The full sentence and flag for the preview of one photo.
 *
 * @param props.image - The photo
 * @param props.auditStartedAt - When its audit started
 */
function AuditPhotoPreviewLine({
  image,
  auditStartedAt,
  assetScannedAt,
}: {
  image: AuditPhotoImage;
  auditStartedAt?: Date | string | null;
  /** When the photo's asset was scanned, when the list knows it */
  assetScannedAt?: Date | string | null;
}) {
  const description = useAuditPhotoDescription(image, {
    assetScannedAt,
    auditStartedAt,
  });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <AuditPhotoSourceIcon description={description} className="size-4" />
      <span>{description.detail}</span>
      <AuditPhotoFlag description={description} />
    </span>
  );
}

/**
 * A clickable audit photo thumbnail with its icon, short time and any flag
 * under it.
 *
 * @param props.image - The photo to show
 * @param props.images - Every photo in the same group, for previous/next in the
 *   preview; defaults to this photo alone
 * @param props.auditStartedAt - When the audit started: what a photo of the
 *   whole audit is checked against
 * @param props.assetScannedAt - When the photo's asset was scanned, for a list
 *   whose photos do not carry `auditAsset.scannedAt` themselves
 * @param props.alt - Alt text, also the preview title
 * @param props.className - Size classes for the thumbnail (and so the tile)
 * @param props.disablePortal - Render the preview inline when already inside a
 *   dialog
 */
export function AuditPhoto({
  image,
  images = [image],
  auditStartedAt,
  assetScannedAt,
  alt,
  className = "size-24",
  disablePortal,
}: {
  image: AuditPhotoImage;
  images?: AuditPhotoImage[];
  auditStartedAt?: Date | string | null;
  assetScannedAt?: Date | string | null;
  alt: string;
  className?: string;
  disablePortal?: boolean;
}) {
  const description = useAuditPhotoDescription(image, {
    assetScannedAt,
    auditStartedAt,
  });

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
          caption: (
            <AuditPhotoPreviewLine
              image={img}
              auditStartedAt={auditStartedAt}
              assetScannedAt={assetScannedAt}
            />
          ),
        }))}
        caption={
          <AuditPhotoPreviewLine
            image={image}
            auditStartedAt={auditStartedAt}
            assetScannedAt={assetScannedAt}
          />
        }
        currentImageId={image.id}
      />
      {/* why: the caption may not widen the tile past its thumbnail, so it
          wraps under the photo instead of pushing the row apart */}
      <figcaption
        className="flex w-0 min-w-full flex-col items-start gap-1 text-xs text-gray-600"
        title={description.detail}
      >
        <span className="sr-only">{description.detail}</span>
        {description.short ? (
          <span className="flex items-center gap-1" aria-hidden>
            <AuditPhotoSourceIcon description={description} />
            {description.short}
          </span>
        ) : null}
        <AuditPhotoFlag description={description} />
      </figcaption>
    </figure>
  );
}

/**
 * Under a photo on the printed receipt, where nothing can be hovered or
 * opened: the icon, the full sentence and any flag.
 *
 * @param props.image - The photo
 * @param props.auditStartedAt - When its audit started
 */
export function AuditPhotoPrintCaption({
  image,
  auditStartedAt,
  assetScannedAt,
}: {
  image: Pick<
    AuditPhotoImage,
    "capturedAt" | "captureSource" | "createdAt" | "auditAsset"
  >;
  auditStartedAt?: Date | string | null;
  /** When the photo's asset was scanned, when the list knows it */
  assetScannedAt?: Date | string | null;
}) {
  const description = useAuditPhotoDescription(image, {
    assetScannedAt,
    auditStartedAt,
  });
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex items-start gap-1">
        <AuditPhotoSourceIcon
          description={description}
          className="mt-px size-3"
        />
        <span>{description.detail}</span>
      </span>
      <AuditPhotoFlag description={description} />
    </span>
  );
}
