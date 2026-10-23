/**
 * Audit photo capture time
 *
 * The server burns a capture stamp (time and asset) into an audit photo only
 * when the upload carries `capturedAt` close to its own clock. The phone sends
 * it for a photo it has just taken with the camera, never for one picked from
 * the photo library, which may be any age. Apps that predate the stamp send
 * nothing and their photos are stored as they are.
 *
 * Pure (no React Native or Expo imports) so Node's test runner can cover it.
 *
 * @see apps/webapp/app/modules/audit/photo-stamp.server.ts the server rule
 * @see apps/webapp/app/routes/api+/mobile+/audits.image.ts the route reading it
 */

/** Where an audit photo came from. */
export type PhotoSource = "camera" | "library";

/** A photo chosen in the evidence sheet, ready to upload. */
export type PickedPhoto = {
  uri: string;
  mimeType: string;
  /** ISO time the camera took it; null for a library photo. */
  capturedAt: string | null;
};

/**
 * Builds the photo the evidence sheet holds until it is uploaded.
 *
 * @param file - The image the picker returned, after any format conversion
 * @param source - Whether it came from the camera or the photo library
 * @param now - The moment the picker returned; defaults to now
 * @returns The photo, with `capturedAt` set only for a camera photo
 */
export function pickedPhoto(
  file: { uri: string; mimeType: string },
  source: PhotoSource,
  now: Date = new Date()
): PickedPhoto {
  return {
    uri: file.uri,
    mimeType: file.mimeType,
    capturedAt: source === "camera" ? now.toISOString() : null,
  };
}

/**
 * The upload URL for one audit photo.
 *
 * `capturedAt` travels in the query with the ids, not in the multipart body:
 * the server stamps the photo while the file streams in, so a body field after
 * the file would arrive too late to count.
 *
 * @param args - The workspace, audit and audit asset ids, and the capture time
 * @returns The path for `apiUpload`
 */
export function auditImageUploadPath({
  orgId,
  auditSessionId,
  auditAssetId,
  capturedAt,
}: {
  orgId: string;
  auditSessionId: string;
  auditAssetId: string;
  capturedAt?: string | null;
}): string {
  const params = new URLSearchParams({ orgId, auditSessionId, auditAssetId });
  if (capturedAt) params.set("capturedAt", capturedAt);
  return `/api/mobile/audits/image?${params}`;
}
