import { describe, expect, it } from "vitest";
import { detectImageFormat } from "./image-format.server";

describe("detectImageFormat", () => {
  it("detects PNG files", () => {
    const buffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(detectImageFormat(buffer)).toBe("image/png");
  });

  it("detects JPEG files", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageFormat(buffer)).toBe("image/jpeg");
  });

  it("detects GIF files", () => {
    const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectImageFormat(buffer)).toBe("image/gif");
  });

  it("detects WebP files", () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageFormat(buffer)).toBe("image/webp");
  });

  it("detects BMP files", () => {
    const buffer = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
    expect(detectImageFormat(buffer)).toBe("image/bmp");
  });

  it("returns null for unsupported formats", () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectImageFormat(buffer)).toBeNull();
  });
});
