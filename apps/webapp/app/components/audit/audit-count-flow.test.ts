/**
 * Unit tests for the web audit scanner's count decisions.
 *
 * The scan route and the drawer call these to decide which scan asks for a
 * count, which scans are still saving, what a recount opens and whether
 * "Complete audit" waits. Rows here are shaped like the scanned list the
 * scanner builds and the counts the loader seeds.
 *
 * @see {@link file://./audit-count-flow.ts}
 */

import { describe, expect, it } from "vitest";

import type { AuditCount, ScanListItems } from "~/atoms/qr-scanner";
import {
  cancelDiscardsScan,
  countScansToSave,
  hasUnsavedCounts,
  isWaitingForCount,
  nextFirstCountPrompt,
  recountPromptFor,
} from "./audit-count-flow";

/** A resolved asset scan as the scanner lists it. */
function scan(
  id: string,
  overrides: Record<string, unknown> = {}
): NonNullable<ScanListItems[string]> {
  return {
    type: "asset",
    codeType: "qr",
    data: { id, title: id, type: "INDIVIDUAL", ...overrides } as never,
  };
}

const POOL_COUNT: AuditCount = {
  expectedQuantity: 14,
  foundQuantity: null,
  unitOfMeasure: "pcs",
};

describe("isWaitingForCount", () => {
  it("holds a listed pool with no count", () => {
    expect(isWaitingForCount(scan("pool-1"), { "pool-1": POOL_COUNT })).toBe(
      true
    );
  });

  it("holds an unlisted pool, known only by its asset type", () => {
    expect(
      isWaitingForCount(scan("pool-2", { type: "QUANTITY_TRACKED" }), {})
    ).toBe(true);
  });

  it("releases a pool once it is counted, zero included", () => {
    expect(
      isWaitingForCount(scan("pool-1"), {
        "pool-1": { ...POOL_COUNT, foundQuantity: 0 },
      })
    ).toBe(false);
  });

  it("never holds an individual asset or a failed scan", () => {
    expect(isWaitingForCount(scan("camera-1"), {})).toBe(false);
    expect(isWaitingForCount({ error: "Not found" }, {})).toBe(false);
  });
});

describe("countScansToSave", () => {
  it("counts unsaved scans except those waiting for a count", () => {
    const items: ScanListItems = {
      "qr-camera": scan("camera-1"),
      "qr-pool": scan("pool-1"),
      "qr-saved": scan("camera-2"),
    };
    expect(
      countScansToSave(items, { "pool-1": POOL_COUNT }, new Set(["camera-2"]))
    ).toBe(1);
  });
});

describe("nextFirstCountPrompt", () => {
  it("asks a listed pool against its snapshot, with All here", () => {
    expect(
      nextFirstCountPrompt({
        scannedItems: { "qr-pool": scan("pool-1", { quantity: 20 }) },
        auditCounts: { "pool-1": POOL_COUNT },
        savedAssetIds: new Set(),
        expectedAssetIds: new Set(["pool-1"]),
      })
    ).toEqual({
      assetId: "pool-1",
      qrId: "qr-pool",
      assetTitle: "pool-1",
      expectedQuantity: 14,
      foundQuantity: null,
      unitOfMeasure: "pcs",
      isExpected: true,
      mode: "first",
    });
  });

  it("marks an unlisted pool as not expected", () => {
    const prompt = nextFirstCountPrompt({
      scannedItems: {
        "qr-pool": scan("pool-2", { type: "QUANTITY_TRACKED", quantity: 50 }),
      },
      auditCounts: {},
      savedAssetIds: new Set(),
      expectedAssetIds: new Set(["pool-1"]),
    });
    expect(prompt).toMatchObject({ assetId: "pool-2", isExpected: false });
  });

  it("skips saved, counted and individual scans", () => {
    expect(
      nextFirstCountPrompt({
        scannedItems: {
          "qr-camera": scan("camera-1"),
          "qr-counted": scan("pool-1"),
          "qr-saved": scan("pool-3", { type: "QUANTITY_TRACKED" }),
        },
        auditCounts: { "pool-1": { ...POOL_COUNT, foundQuantity: 8 } },
        savedAssetIds: new Set(["pool-3"]),
        expectedAssetIds: new Set(["pool-1"]),
      })
    ).toBeNull();
  });
});

describe("recountPromptFor", () => {
  it("reopens a counted pool with its count", () => {
    expect(
      recountPromptFor({
        assetId: "pool-1",
        qrId: "qr-pool",
        assetTitle: "Sandbag",
        auditCounts: { "pool-1": { ...POOL_COUNT, foundQuantity: 8 } },
        expectedAssetIds: new Set(["pool-1"]),
      })
    ).toMatchObject({
      mode: "recount",
      foundQuantity: 8,
      expectedQuantity: 14,
      isExpected: true,
    });
  });

  it("returns null for an asset without a count, so it stays a duplicate", () => {
    expect(
      recountPromptFor({
        assetId: "camera-1",
        qrId: "qr-camera",
        assetTitle: "Camera",
        auditCounts: {},
        expectedAssetIds: new Set(["camera-1"]),
      })
    ).toBeNull();
  });
});

describe("cancelDiscardsScan", () => {
  it("drops a scan whose first count is cancelled and keeps a recounted one", () => {
    const prompt = recountPromptFor({
      assetId: "pool-1",
      qrId: "qr-pool",
      assetTitle: "Sandbag",
      auditCounts: { "pool-1": POOL_COUNT },
      expectedAssetIds: new Set(),
    });
    expect(prompt && cancelDiscardsScan(prompt)).toBe(false);
    expect(cancelDiscardsScan({ ...prompt!, mode: "first" })).toBe(true);
  });
});

describe("hasUnsavedCounts", () => {
  it("holds completion only while a count is unsaved", () => {
    expect(hasUnsavedCounts({ "pool-1": POOL_COUNT })).toBe(false);
    expect(
      hasUnsavedCounts({
        "pool-1": { ...POOL_COUNT, foundQuantity: 9, unsaved: true },
      })
    ).toBe(true);
  });
});
