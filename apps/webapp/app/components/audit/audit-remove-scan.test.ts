/**
 * Tests for deciding when a removed audit scan has to be put back.
 *
 * @see {@link file://./audit-remove-scan.ts}
 */
import { describe, expect, it } from "vitest";
import type { ScanListItem } from "~/atoms/qr-scanner";
import type { PendingScanRemoval } from "./audit-remove-scan";
import { refusedScanRemoval } from "./audit-remove-scan";

const pending: PendingScanRemoval = {
  qrId: "qr-1",
  assetId: "asset-1",
  item: {
    data: { id: "asset-1", title: "Camera" },
    type: "asset",
    codeType: "qr",
  } as unknown as ScanListItem,
  count: undefined,
};

describe("refusedScanRemoval", () => {
  it("puts the scan back when the server refused the removal", () => {
    expect(
      refusedScanRemoval(pending, {
        error: { message: "This audit is no longer active." },
      })
    ).toBe(pending);
  });

  it("puts it back for a server failure too: the removal rolled back", () => {
    expect(
      refusedScanRemoval(pending, {
        error: { message: "Something went wrong" },
        scanSubmitFailure: { kind: "server", status: 500 },
      })
    ).toBe(pending);
  });

  it("leaves a removal that went through", () => {
    expect(refusedScanRemoval(pending, { success: true, error: null })).toBe(
      null
    );
    expect(refusedScanRemoval(pending, { success: true })).toBe(null);
  });

  it("does nothing when no removal was waiting", () => {
    expect(refusedScanRemoval(null, { error: { message: "x" } })).toBe(null);
  });
});
