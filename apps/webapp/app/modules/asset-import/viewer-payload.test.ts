/**
 * Tests for the viewer-dependent shaping of the active import.
 *
 * @see {@link file://./viewer-payload.ts}
 */
import { describe, expect, it } from "vitest";
import type { AssetImportStatusPayload } from "./types";
import {
  isFullImportPayload,
  shapeActiveImportForViewer,
} from "./viewer-payload";

const full: AssetImportStatusPayload = {
  id: "imp",
  status: "RUNNING",
  phase: "ROWS",
  fileName: "secret-name.csv",
  totalRows: 10,
  processedRows: 3,
  errorMessage: "boom",
  warningCount: 2,
  completedAt: null,
  isMine: false,
};

describe("shapeActiveImportForViewer", () => {
  it("returns the full payload for members who can import", () => {
    expect(shapeActiveImportForViewer(full, true)).toBe(full);
  });

  it("returns only progress fields for members who cannot import", () => {
    const shaped = shapeActiveImportForViewer(full, false);

    expect(shaped).toEqual({
      status: "RUNNING",
      phase: "ROWS",
      processedRows: 3,
      totalRows: 10,
    });
    expect(isFullImportPayload(shaped)).toBe(false);
  });

  it("returns null when nothing is active", () => {
    expect(shapeActiveImportForViewer(null, true)).toBeNull();
    expect(isFullImportPayload(shapeActiveImportForViewer(full, true))).toBe(
      true
    );
  });
});
