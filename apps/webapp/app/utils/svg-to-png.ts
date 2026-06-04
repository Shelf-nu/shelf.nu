/**
 * svgToPngBlob — rasterize an SVG string to a high-resolution PNG (browser-only).
 *
 * Used to give users a PNG that is genuinely sharp because it's rasterized from
 * the **vector** label at a high pixel width — not an upscaled small bitmap.
 *
 * @see {@link file://./../modules/qr/label.ts} (buildLabelSvg)
 */

/** Default raster width in px — ~27px/module for a typical label = crisp at print. */
const DEFAULT_PNG_WIDTH = 1024;

/**
 * Rasterizes an SVG string to a PNG blob, preserving the SVG's aspect ratio.
 *
 * @param svg - a complete `<svg>` string (must carry a `viewBox`)
 * @param pxWidth - target width in pixels (height derived from the viewBox)
 * @returns a PNG `Blob`
 * @throws if the canvas context is unavailable or encoding fails
 */
export async function svgToPngBlob(
  svg: string,
  pxWidth: number = DEFAULT_PNG_WIDTH
): Promise<Blob> {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) {
    // Fail loud rather than emit a distorted 1x1-derived PNG.
    throw new Error(
      'svgToPngBlob: SVG is missing a `viewBox="0 0 W H"` — cannot size the raster.'
    );
  }
  const w = parseFloat(vb[1]);
  const h = parseFloat(vb[2]);
  const pxHeight = Math.max(1, Math.round(pxWidth * (h / w)));

  const img = new Image();
  img.width = pxWidth;
  img.height = pxHeight;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable for PNG export");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pxWidth, pxHeight);
  ctx.drawImage(img, 0, 0, pxWidth, pxHeight);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png"
    );
  });
}
