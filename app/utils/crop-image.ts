import type { ResizeOptions } from "sharp";

export const cropImage = async (data: ArrayBuffer, options?: ResizeOptions) => {
  // @ts-ignore
  const sharp = (await import("sharp")).default;

  return sharp(data)
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
