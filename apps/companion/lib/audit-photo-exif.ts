/**
 * How and when an audit photo was taken, as the phone's image picker saw it
 *
 * The server reads when an audit photo was taken from the file's EXIF. The
 * file this app uploads often has none left: converting an iPhone HEIC photo
 * to JPEG drops EXIF, and so does the iOS picker's own JPEG re-encode. So the
 * app reads the date from the picker result (`exif: true`) and sends it with
 * the file as `exifDateTimeOriginal` / `exifOffsetTimeOriginal`. The server
 * prefers the file's own EXIF and falls back to these fields. It also sends
 * `captureSource`: a photo from the app's own camera cannot be an old picture,
 * which an editable EXIF date cannot prove. The words shown under each photo
 * come from `describeAuditPhotoTime` in `@shelf/labels`.
 *
 * Pure, so it runs under Node's test runner: no React Native, Expo or
 * `@/`-aliased imports.
 *
 * @see ./audit-photo-exif.test.ts
 * @see ../components/audit/evidence-modal.tsx the picker
 * @see ./api/audits.ts `uploadImage`, which sends the fields
 * @see ../../webapp/app/modules/audit/photo-captured-at.server.ts the server
 */

/** The EXIF tags the capture time is read from, as EXIF text. */
export type PhotoCaptureTags = {
  /** `YYYY:MM:DD HH:MM:SS`, the camera's wall-clock time */
  dateTimeOriginal: string;
  /** `+HH:MM` / `-HH:MM`, when the device wrote one */
  offsetTimeOriginal: string | null;
};

/** The picker's EXIF object; its shape differs between iOS and Android. */
export type PickerExif = Record<string, unknown> | null | undefined;

/** Reads one tag as a non-empty string, or null. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Picks the capture tags out of an image picker result's `exif`.
 *
 * Android returns the tags flat (`exif.DateTimeOriginal`). iOS nests them by
 * dictionary (`exif["{Exif}"].DateTimeOriginal`). Both are read.
 *
 * @param exif - `ImagePickerAsset.exif`
 * @returns The tags, or null when the photo carries no capture date
 */
export function captureTagsFromPickerExif(
  exif: PickerExif
): PhotoCaptureTags | null {
  if (!exif) return null;

  const nested = exif["{Exif}"];
  const exifDictionary =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : {};

  const dateTimeOriginal =
    text(exif.DateTimeOriginal) ?? text(exifDictionary.DateTimeOriginal);
  if (!dateTimeOriginal) return null;

  return {
    dateTimeOriginal,
    offsetTimeOriginal:
      text(exif.OffsetTimeOriginal) ?? text(exifDictionary.OffsetTimeOriginal),
  };
}

/** How the phone app captured a photo: its own camera, or the photo library. */
export type PhotoCaptureSource = "CAMERA" | "LIBRARY";

/** Everything the app knows about how and when a picked photo was taken. */
export type PhotoCapture = {
  source: PhotoCaptureSource;
  /** The EXIF capture tags; null when the photo carries no date */
  tags: PhotoCaptureTags | null;
};

/**
 * Describes a photo the picker just returned.
 *
 * @param fromCamera - True for `launchCameraAsync` (the app's own camera, which
 *   cannot hand back an old picture), false for the photo library
 * @param exif - `ImagePickerAsset.exif`
 * @returns How and when the photo was taken
 */
export function photoCaptureFromPicker(
  fromCamera: boolean,
  exif: PickerExif
): PhotoCapture {
  return {
    source: fromCamera ? "CAMERA" : "LIBRARY",
    tags: captureTagsFromPickerExif(exif),
  };
}

/**
 * Adds how and when a photo was taken to an upload, as the form fields the
 * server reads: `captureSource`, `exifDateTimeOriginal` and
 * `exifOffsetTimeOriginal`.
 *
 * @param formData - The multipart upload
 * @param capture - From {@link photoCaptureFromPicker}; nothing is added when
 *   null
 */
export function appendPhotoCapture(
  formData: Pick<FormData, "append">,
  capture: PhotoCapture | null
): void {
  if (!capture) return;
  formData.append("captureSource", capture.source);
  if (!capture.tags) return;
  formData.append("exifDateTimeOriginal", capture.tags.dateTimeOriginal);
  if (capture.tags.offsetTimeOriginal) {
    formData.append("exifOffsetTimeOriginal", capture.tags.offsetTimeOriginal);
  }
}
