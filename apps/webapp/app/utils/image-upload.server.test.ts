import { describe, expect, it } from "vitest";
import { assertUploadedImageContentType } from "./image-upload.server";

describe("assertUploadedImageContentType", () => {
  it("returns the format proved by the bytes, ignoring any claim", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(assertUploadedImageContentType(png)).toBe("image/png");
  });

  it("rejects a document dressed up as an image", () => {
    const html = Buffer.from("<script>alert(document.domain)</script>");
    expect(() => assertUploadedImageContentType(html)).toThrowError(
      /not a supported image/i
    );
  });

  it("rejects SVG, which is a script-capable document rather than a raster image", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() => assertUploadedImageContentType(svg)).toThrowError(
      /not a supported image/i
    );
  });

  it("rejects a raster format the upload inputs do not offer", () => {
    const bmp = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
    expect(() => assertUploadedImageContentType(bmp)).toThrowError(
      /not a supported image/i
    );
  });

  it("reports a rejection as user input rather than a server fault", () => {
    const html = Buffer.from("<script>alert(document.domain)</script>");
    try {
      assertUploadedImageContentType(html);
      throw new Error("expected a rejection");
    } catch (cause) {
      expect(cause).toMatchObject({ status: 400, shouldBeCaptured: false });
    }
  });
});
