import type { ResizeOptions } from "sharp";
import { ShelfError } from "./error";
import { getFileArrayBuffer } from "./getFileArrayBuffer";

/** @TODO this should be good, but still better to just be sure to double test it*/
export const cropImage = async (
  data: AsyncIterable<Uint8Array>,
  options?: ResizeOptions
) => {
  try {
    const sharp = (await import("sharp")).default;

    return await sharp(await getFileArrayBuffer(data))
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
