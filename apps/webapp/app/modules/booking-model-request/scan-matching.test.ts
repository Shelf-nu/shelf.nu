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
    expect(result.rows[0].matchedModelName).toBe("Model One");
    expect(result.matchedCountByModel.get("model-1")).toBe(1);
  });

  it("leaves a scan whose model is not reserved unmatched", () => {
    const result = matchScansToModelRequests(
      input({ items: { "qr-1": assetScan("asset-1", "model-other") } })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["unmatched"]);
    expect(result.rows[0].unmatchedReason).toBe("notReserved");
    expect(result.matchedCountByModel.get("model-1")).toBeUndefined();
  });

  // An over-scan must not push a strip past its total.
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

  // A reserved unit is a whole unit.
  it("says an over-scan of a reserved model is over the count", () => {
    const result = matchScansToModelRequests(
      input({
        items: {
          "qr-1": assetScan("asset-1", "model-1"),
          "qr-2": assetScan("asset-2", "model-1"),
        },
        expectedModelRequests: [
          {
            assetModelId: "model-1",
            assetModelName: "Model One",
            booked: 1,
            remaining: 1,
          },
        ],
      })
    );

    const unmatched = result.rows.filter((row) => row.bucket === "unmatched");
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].unmatchedReason).toBe("overReserved");
    expect(unmatched[0].overReservedModelName).toBe("Model One");
  });

  // A reservation filled before the session started is gone from the
  // outstanding list, but its model is still reserved.
  it("names a fully filled reserved model as over the count", () => {
    const result = matchScansToModelRequests(
      input({
        items: { "qr-1": assetScan("asset-1", "model-2") },
        reservedModels: [
          { assetModelId: "model-2", assetModelName: "Model Two" },
        ],
      })
    );

    expect(result.rows[0].unmatchedReason).toBe("overReserved");
    expect(result.rows[0].overReservedModelName).toBe("Model Two");
  });

  it("never counts a quantity-tracked scan", () => {
    const result = matchScansToModelRequests(
      input({
        items: {
          "qr-1": assetScan("asset-1", "model-1", AssetType.QUANTITY_TRACKED),
        },
      })
    );

    expect(result.rows.map((row) => row.bucket)).toEqual(["unmatched"]);
    // A reservation is for whole units, so the scan is neither over the
    // count nor of an unreserved model.
    expect(result.rows[0].unmatchedReason).toBeUndefined();
    expect(result.matchedCountByModel.get("model-1")).toBeUndefined();
  });

  // The fetch resolves after the row appears.
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
