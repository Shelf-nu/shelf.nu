import type { ResizeOptions } from "sharp";
import { ShelfError } from "./error";

export const cropImage = async (
  data: AsyncIterable<Uint8Array>,
  options?: ResizeOptions
) => {
  try {
    const chunks = [];
    for await (const chunk of data) {
      chunks.push(chunk);
    }

    const sharp = (await import("sharp")).default;

    return await sharp(Buffer.concat(chunks))
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
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while cropping the image. Please try again. If the issue persists contact support.",
      label: "Crop image",
    });
  }
};
