export async function gifToPng(dataUrl: string) {
  // @ts-ignore
  const sharp = (await import("sharp")).default;

  const gifBuffer = Buffer.from(
    dataUrl.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );
  const pngBuffer = await sharp(gifBuffer).png().toBuffer();
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
}
