import { AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { ScanMatchingInput } from "./scan-matching";
import { matchScansToModelRequests } from "./scan-matching";

/** A resolved asset scan, in the shape `scannedItemsAtom` holds. */
function assetScan(
  id: string,
  assetModelId: string | null,
  type: AssetType = AssetType.INDIVIDUAL
) {
  return {
    type: "asset" as const,
    data: { id, title: id, type, assetModelId } as never,
  };
}

/** Baseline input: no scans, one model reserving 2 units. */
function input(overrides: Partial<ScanMatchingInput> = {}): ScanMatchingInput {
  return {
    items: {},
    expectedModelRequests: [
      {
        assetModelId: "model-1",
        assetModelName: "Model One",
        booked: 2,
        remaining: 2,
      },
    ],
    alreadyIncludedIds: new Set<string>(),
    claimableIncludedIds: new Set<string>(),
    checksOutScannedOnly: false,
    ...overrides,
  };
}

describe("matchScansToModelRequests", () => {
  it("matches a scan whose model is reserved", () => {
    const result = matchScansToModelRequests(
      input({ items: { "qr-1": assetScan("asset-1", "model-1") } })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["matched"]);
    expect(result.matchedCountByModel.get("model-1")).toBe(1);
  });

  it("leaves a scan whose model is not reserved unmatched", () => {
    const result = matchScansToModelRequests(
      input({ items: { "qr-1": assetScan("asset-1", "model-other") } })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["unmatched"]);
    expect(result.matchedCountByModel.get("model-1")).toBeUndefined();
  });

  // Review Focus 3: an over-scan must not push a strip past its total.
  it("stops matching once a model's remaining count is used up", () => {
    const result = matchScansToModelRequests(
      input({
        items: {
          "qr-1": assetScan("asset-1", "model-1"),
          "qr-2": assetScan("asset-2", "model-1"),
          "qr-3": assetScan("asset-3", "model-1"),
        },
      })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual([
      "matched",
      "matched",
      "unmatched",
    ]);
    expect(result.matchedCountByModel.get("model-1")).toBe(2);
  });

  // Review Focus 2: a reserved unit is a whole unit.
  it("never counts a quantity-tracked scan", () => {
    const result = matchScansToModelRequests(
      input({
        items: {
          "qr-1": assetScan("asset-1", "model-1", AssetType.QUANTITY_TRACKED),
        },
      })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["unmatched"]);
    expect(result.matchedCountByModel.get("model-1")).toBeUndefined();
  });

  // Review Focus 4: the fetch resolves after the row appears.
  it("parks an unresolved scan as unmatched without crashing", () => {
    const result = matchScansToModelRequests(
      input({ items: { "qr-1": { type: "asset" as const, data: undefined } } })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["unmatched"]);
  });

  it("counts an already-included claimable scan and reports its model", () => {
    const result = matchScansToModelRequests(
      input({
        items: { "qr-1": assetScan("asset-1", "model-1") },
        alreadyIncludedIds: new Set(["asset-1"]),
        claimableIncludedIds: new Set(["asset-1"]),
      })
    );

    expect(result.rows[0].bucket).toBe("claimed");
    expect(result.rows[0].claimedModelName).toBe("Model One");
    expect(result.matchedCountByModel.get("model-1")).toBe(1);
  });

  it("treats an already-included scan that can claim nothing as a duplicate", () => {
    const result = matchScansToModelRequests(
      input({
        items: { "qr-1": assetScan("asset-1", "model-1") },
        alreadyIncludedIds: new Set(["asset-1"]),
      })
    );

    expect(result.rows[0].bucket).toBe("duplicate");
    expect(result.matchedCountByModel.get("model-1")).toBeUndefined();
  });

  it("checks an already-included scan out when only scanned items leave", () => {
    const result = matchScansToModelRequests(
      input({
        items: { "qr-1": assetScan("asset-1", "model-1") },
        alreadyIncludedIds: new Set(["asset-1"]),
        checksOutScannedOnly: true,
      })
    );

    expect(result.rows[0].bucket).toBe("included");
  });
});
