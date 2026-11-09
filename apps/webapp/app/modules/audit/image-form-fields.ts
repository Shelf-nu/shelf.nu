/**
 * Audit Image Form Fields
 *
 * The text fields an audit photo upload carries next to its `image` file: the
 * note typed with it and what the phone app knows about when and how the photo
 * was taken. `uploadAuditImage` asks `parseFileFormData` for exactly these, so
 * they come from the same size-limited parse as the file, and no text part can
 * stand in for the `image` upload itself.
 *
 * @see {@link file://./image.service.server.ts}
 * @see {@link file://./photo-captured-at.server.ts} reads the EXIF, time zone
 *   and capture source fields
 * @see {@link file://./../../routes/api+/mobile+/audits.image.ts} reads `content`
 */

/** Text parts of an audit photo upload. Never includes the `image` file field. */
export const AUDIT_IMAGE_TEXT_FIELDS = [
  "content",
  "exifDateTimeOriginal",
  "exifOffsetTimeOriginal",
  "deviceTimeZone",
  "captureSource",
] as const;
