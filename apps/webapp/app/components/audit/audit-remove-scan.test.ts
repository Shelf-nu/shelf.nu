/**
 * Tests for reading the answer to an audit scan removal.
 *
 * @see {@link file://./audit-remove-scan.ts}
 */
import { describe, expect, it } from "vitest";
import type { ScanListItem } from "~/atoms/qr-scanner";
import {
  refusedRemovalMessage,
  reloadWouldLoseWork,
} from "./audit-remove-scan";

describe("refusedRemovalMessage", () => {
  it("gives the server's message when the removal was refused", () => {
    expect(
      refusedRemovalMessage({
        error: { message: "This audit is no longer active." },
      })
    ).toBe("This audit is no longer active.");
  });

  it("treats a server failure as refused: the removal rolled back", () => {
    expect(
      refusedRemovalMessage({
        error: { message: "Something went wrong" },
        scanSubmitFailure: { kind: "server", status: 500 },
      })
    ).toBe("Something went wrong");
  });

  it("falls back to a message of its own when the error has none", () => {
    expect(refusedRemovalMessage({ error: {} })).toBe(
      "The server did not remove it."
    );
  });

  it("is null for a removal that went through", () => {
    expect(refusedRemovalMessage({ success: true, error: null })).toBe(null);
    expect(refusedRemovalMessage({ success: true })).toBe(null);
    expect(refusedRemovalMessage(undefined)).toBe(null);
  });
});

describe("reloadWouldLoseWork", () => {
  const camera = {
    data: { id: "asset-1", title: "Camera", type: "INDIVIDUAL" },
    type: "asset",
    codeType: "qr",
  } as unknown as ScanListItem;
  const listed = new Set(["asset-1"]);

  it("lets a reload through when everything is saved", () => {
    expect(
      reloadWouldLoseWork({
        pendingScanCount: 0,
        items: { "qr-1": camera },
        auditCounts: {},
        listedAssetIds: listed,
      })
    ).toBe(false);
  });

  it("holds it while a scan is still saving", () => {
    expect(
      reloadWouldLoseWork({
        pendingScanCount: 1,
        items: { "qr-1": camera },
        auditCounts: {},
        listedAssetIds: listed,
      })
    ).toBe(true);
  });

  it("holds it while a count is entered and not saved", () => {
    expect(
      reloadWouldLoseWork({
        pendingScanCount: 0,
        items: { "qr-1": camera },
        auditCounts: {
          "asset-1": {
            expectedQuantity: 3,
            foundQuantity: 5,
            unitOfMeasure: null,
            unsaved: true,
          },
        },
        listedAssetIds: listed,
      })
    ).toBe(true);
  });
});
