/**
 * Tests for deciding when a removed audit scan has to be put back.
 *
 * @see {@link file://./audit-remove-scan.ts}
 */
import { describe, expect, it } from "vitest";
import type { ScanListItem } from "~/atoms/qr-scanner";
import type { PendingScanRemoval } from "./audit-remove-scan";
import { refusedScanRemoval, wasScanSaved } from "./audit-remove-scan";

const pending: PendingScanRemoval = {
  auditSessionId: "audit-1",
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
      refusedScanRemoval(
        pending,
        { error: { message: "This audit is no longer active." } },
        "audit-1"
      )
    ).toBe(pending);
  });

  it("puts it back for a server failure too: the removal rolled back", () => {
    expect(
      refusedScanRemoval(
        pending,
        {
          error: { message: "Something went wrong" },
          scanSubmitFailure: { kind: "server", status: 500 },
        },
        "audit-1"
      )
    ).toBe(pending);
  });

  it("leaves a removal that went through", () => {
    expect(
      refusedScanRemoval(pending, { success: true, error: null }, "audit-1")
    ).toBe(null);
    expect(refusedScanRemoval(pending, { success: true }, "audit-1")).toBe(
      null
    );
  });

  it("does nothing when no removal was waiting", () => {
    expect(
      refusedScanRemoval(null, { error: { message: "x" } }, "audit-1")
    ).toBe(null);
  });

  it("leaves a refusal for another audit than the one on screen", () => {
    expect(
      refusedScanRemoval(pending, { error: { message: "x" } }, "audit-2")
    ).toBe(null);
  });
});

describe("wasScanSaved", () => {
  const persisted = new Set(["asset-1"]);

  it("is saved when recorded and nothing of it is in flight", () => {
    expect(wasScanSaved("asset-1", persisted, new Map())).toBe(true);
  });

  /**
   * A recount still saving when the scan was removed: put back as saved, it
   * would never be sent again and Complete Audit would wait on it forever.
   */
  it("is not saved while a save of it is still waiting", () => {
    expect(
      wasScanSaved("asset-1", persisted, new Map([["asset-1", "qr-1"]]))
    ).toBe(false);
  });

  it("is not saved before its first save answered", () => {
    expect(wasScanSaved("asset-2", persisted, new Map())).toBe(false);
  });
});
