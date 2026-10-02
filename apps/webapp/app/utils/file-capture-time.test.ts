import { describe, expect, it } from "vitest";
import { fileCaptureTime } from "./file-capture-time";

describe("fileCaptureTime", () => {
  it("returns the file's lastModified as an ISO time", () => {
    expect(
      fileCaptureTime({ lastModified: Date.parse("2026-10-01T21:01:30Z") })
    ).toBe("2026-10-01T21:01:30.000Z");
  });

  it("returns null when the browser gave no usable time", () => {
    expect(fileCaptureTime({ lastModified: 0 })).toBeNull();
    expect(fileCaptureTime({ lastModified: Number.NaN })).toBeNull();
  });
});
