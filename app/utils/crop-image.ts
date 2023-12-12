import type { ResizeOptions } from "sharp";
import { getFileArrayBuffer } from "./getFileArrayBuffer";

export const cropImage = async (
  data: AsyncIterable<Uint8Array>,
  options?: ResizeOptions
) => {
  // @ts-ignore
  const sharp = (await import("sharp")).default;

  return sharp(await getFileArrayBuffer(data))
    .rotate()
    .resize(
      options || {
        height: 150,
        width: 150,
        fit: sharp.fit.cover,
        withoutEnlargement: true,
      }
    )
    .toFormat("webp")
    .toBuffer();
};
