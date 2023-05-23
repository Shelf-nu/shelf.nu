import type { ResizeOptions } from "sharp";

export const cropImage = async (
  data: AsyncIterable<Uint8Array>,
  options?: ResizeOptions
) => {
  const chunks = [];
  for await (const chunk of data) {
    chunks.push(chunk);
  }

  // @ts-ignore
  const sharp = (await import("sharp")).default;

  return sharp(Buffer.concat(chunks))
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
