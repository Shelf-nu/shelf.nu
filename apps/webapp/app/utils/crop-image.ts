import type { ResizeOptions } from "sharp";
import { isLikeShelfError, ShelfError } from "./error";
import { detectImageFormat } from "./image-format.server";

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
        message: "Unsupported image format",
        additionalData: { size: buffer.length },
        label: "Crop image",
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

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while cropping the image. Please try again. If the issue persists contact support.",
      label: "Crop image",
    });
  }
};
