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
 * Errors sharp raises while DECODING its input: a truncated or corrupt file.
 * The format check has already passed when sharp runs, so these describe the
 * uploaded bytes, not the server. Anything else (memory, output) stays a 500.
 */
const UNREADABLE_INPUT =
  /^(?:Vips|Input buffer|Input file)|premature end|corrupt|bad (?:huffman|marker)/i;

/**
 * Whether a sharp failure means the uploaded image itself is unreadable.
 *
 * @param cause - What sharp threw
 * @returns True when the input could not be decoded
 */
function isUnreadableImageError(cause: unknown): boolean {
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
