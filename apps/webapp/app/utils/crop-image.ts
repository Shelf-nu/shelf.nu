/**
 * Image cropping for uploads
 *
 * Normalises an uploaded image (orientation, size, WebP) before it is stored.
 * A file the user sent that cannot be used, because it is not an image or is
 * damaged, is answered as a 400 the user can act on, never as a server fault.
 *
 * @see {@link file://./storage.server.ts} `uploadFile`, its caller
 */
import type { ResizeOptions } from "sharp";
import { isLikeShelfError, ShelfError } from "./error";
import { detectImageFormat } from "./image-format.server";

/**
 * Messages sharp raises when it cannot DECODE its input: sharp's own two
 * buffer-input errors, and the decoder wording for a truncated or corrupt
 * file. They describe the uploaded bytes, not the server.
 *
 * Matched on what the message says, never on a bare `Vips` prefix: libvips
 * uses that prefix for every class, including the WebP encoder and memory or
 * region failures, which must stay captured 500s.
 */
const UNREADABLE_INPUT =
  /^Input buffer|premature end|corrupt|bad (?:huffman|marker)|unexpected end|truncated/i;

/**
 * Whether a sharp failure means the uploaded image itself is unreadable.
 *
 * @param cause - What sharp threw
 * @returns True when the input could not be decoded
 */
export function isUnreadableImageError(cause: unknown): boolean {
  return cause instanceof Error && UNREADABLE_INPUT.test(cause.message);
}

/**
 * Reads an uploaded image and returns it resized and encoded as WebP.
 *
 * @param data - The upload as it streams in
 * @param options - Resize options; defaults to a 150px square thumbnail
 * @returns The processed image
 * @throws {ShelfError} 400 when the file is not a supported image or cannot be
 *   decoded; 500 for any other failure
 */
export const cropImage = async (
  data: AsyncIterable<Uint8Array>,
  options?: ResizeOptions
) => {
  try {
    const chunks = [];
    for await (const chunk of data) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const detectedFormat = detectImageFormat(buffer);

    if (!detectedFormat) {
      throw new ShelfError({
        cause: null,
        title: "Unsupported image format",
        message:
          "The uploaded image format is not supported. Please upload a JPEG, PNG, GIF, WebP, or BMP image.",
        additionalData: { size: buffer.length },
        label: "Crop image",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const sharp = (await import("sharp")).default;

    return await sharp(buffer)
      .rotate()
      .resize(
        options || {
          height: 150,
          width: 150,
          fit: sharp.fit.cover,
          withoutEnlargement: true,
        }
      )
      .webp({ quality: 80 })
      .toBuffer();
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    if (isUnreadableImageError(cause)) {
      throw new ShelfError({
        cause,
        title: "Image could not be read",
        message:
          "This image could not be read. It may be damaged or only partly uploaded. Save it again or choose another image, then try again.",
        label: "Crop image",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while cropping the image. Please try again. If the issue persists contact support.",
      label: "Crop image",
    });
  }
};
