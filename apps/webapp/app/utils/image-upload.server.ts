/**
 * Upload-side validation for images persisted as raw bytes.
 *
 * Rows in the `Image` table store the uploaded bytes verbatim and are served
 * back inline from the application origin by `api+/image.$imageId`, so the
 * content type persisted next to them decides how a browser renders the
 * response. This module is the single place that decides what that type may
 * be.
 *
 * Kept separate from `image-format.server` — the magic-byte detector there is
 * deliberately import-free because `crop-image` pulls it into every storage
 * upload.
 *
 * @see {@link file://./image-format.server.ts}
 * @see {@link file://./../routes/api+/image.$imageId.ts}
 */

import { ShelfError } from "./error";
import { detectImageFormat } from "./image-format.server";

/**
 * Content types accepted for newly uploaded images.
 *
 * Mirrors `ACCEPT_SUPPORTED_IMAGES`, the `accept` attribute every upload input
 * carries. That attribute is a convenience for the file picker and not a
 * boundary — a crafted multipart request can claim any type — so the server
 * re-derives the format from the file's own bytes and checks it against this
 * list.
 *
 * SVG is deliberately absent and must stay absent: it is an XML document that
 * can carry script, so it can never be stored for inline delivery from the
 * application origin.
 */
export const UPLOADABLE_IMAGE_CONTENT_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

/**
 * Validates uploaded bytes and returns the content type to persist with them.
 *
 * A caller's `File.type` is a claim rather than evidence, so the format is
 * taken from the magic bytes and the claim is discarded.
 *
 * @param blob - The uploaded image bytes
 * @param additionalData - Context merged into the error when validation fails
 * @returns The content type to store alongside the blob
 * @throws {ShelfError} 400 when the bytes are not a supported image format
 */
export function assertUploadedImageContentType(
  blob: Uint8Array,
  additionalData: Record<string, unknown> = {}
): string {
  const detectedFormat = detectImageFormat(blob);

  if (
    !detectedFormat ||
    !UPLOADABLE_IMAGE_CONTENT_TYPES.includes(detectedFormat)
  ) {
    throw new ShelfError({
      cause: null,
      title: "Unsupported image format",
      message:
        "The uploaded file is not a supported image. Please upload a PNG, JPEG or WebP image.",
      additionalData: { ...additionalData, detectedFormat },
      label: "Image",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return detectedFormat;
}
