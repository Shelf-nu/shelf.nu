/**
 * The capture date of an audit photo, as the phone's image picker read it
 *
 * The server reads when an audit photo was taken from the file's EXIF. The
 * file this app uploads often has none left: converting an iPhone HEIC photo
 * to JPEG drops EXIF, and the picker's re-encode may too. So the app reads the
 * date from the picker result (`exif: true`) and sends it alongside the file
 * as `exifDateTimeOriginal` / `exifOffsetTimeOriginal`. The server prefers the
 * file's own EXIF and falls back to these fields.
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

/**
 * Adds the capture tags to an upload as the form fields the server reads.
 *
 * @param formData - The multipart upload
 * @param tags - The tags from {@link captureTagsFromPickerExif}; nothing is
 *   added when null
 */
export function appendCaptureTags(
  formData: Pick<FormData, "append">,
  tags: PhotoCaptureTags | null
): void {
  if (!tags) return;
  formData.append("exifDateTimeOriginal", tags.dateTimeOriginal);
  if (tags.offsetTimeOriginal) {
    formData.append("exifOffsetTimeOriginal", tags.offsetTimeOriginal);
  }
}
