import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropImage, isUnreadableImageError } from "./crop-image";

// @vitest-environment node

/** Streams a buffer the way an upload arrives. */
async function* streamOf(buffer: Buffer) {
  await Promise.resolve();
  yield new Uint8Array(buffer);
}

/** A real JPEG, so the format check passes and sharp does the decoding. */
async function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: "#ef6820" },
  })
    .jpeg()
    .toBuffer();
}

describe("cropImage", () => {
  it("crops a readable image", async () => {
    const cropped = await cropImage(streamOf(await jpeg()));

    expect((await sharp(cropped).metadata()).format).toBe("webp");
  });

  it("refuses an image cut off partway as the user's error, not a crash", async () => {
    // A JPEG whose upload stopped halfway: the header is intact, so the format
    // check passes, and the decoder fails on the missing data.
    const full = await jpeg();
    const truncated = full.subarray(0, Math.floor(full.length / 2));

    await expect(cropImage(streamOf(truncated))).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      title: "Image could not be read",
    });
  });

  it("refuses a file that is not an image as the user's error", async () => {
    await expect(
      cropImage(streamOf(Buffer.from("definitely not an image")))
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      title: "Unsupported image format",
    });
  });
});

describe("isUnreadableImageError", () => {
  it.each([
    "VipsJpeg: Premature end of JPEG file",
    "Input buffer contains unsupported image format",
    "Input buffer has corrupt header: VipsJpeg: bad marker",
    "VipsForeignLoadPng: libspng read error: unexpected end of file",
    "gifload: truncated file",
  ])("treats a decoding failure as the user's file: %s", (message) => {
    expect(isUnreadableImageError(new Error(message))).toBe(true);
  });

  it.each([
    "VipsForeignSaveWebp: unable to encode",
    "VipsImage: memory area too small --- should be 1024 bytes, you passed 512",
    "vips_region_buffer: out of memory",
    "Input image exceeds pixel limit",
  ])("keeps a server-side failure a server error: %s", (message) => {
    expect(isUnreadableImageError(new Error(message))).toBe(false);
  });

  it("is false for anything that is not an Error", () => {
    expect(isUnreadableImageError("premature end")).toBe(false);
  });
});
