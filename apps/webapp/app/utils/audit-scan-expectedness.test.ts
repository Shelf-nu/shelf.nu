import { describe, expect, it } from "vitest";

import { resolveScannedExpectedness } from "./audit-scan-expectedness";

/**
 * The rule this pins: a deleted asset's expectedness comes from the scan's own
 * snapshot, and a live asset's from the audit's expected list. Getting it wrong
 * is invisible — every row still renders, just under the wrong heading — so the
 * deleted cases are asserted in BOTH directions.
 */
describe("resolveScannedExpectedness", () => {
  const expectedAssetIds = new Set(["asset-1", "asset-2"]);

  it("reads a live asset from the expected list", () => {
    expect(
      resolveScannedExpectedness({
        assetId: "asset-1",
        assetDeleted: false,
        isExpected: false, // stale snapshot must lose to the live list
        expectedAssetIds,
      })
    ).toBe(true);
  });

  it("calls a live asset that is not on the list unexpected", () => {
    expect(
      resolveScannedExpectedness({
        assetId: "asset-99",
        assetDeleted: false,
        isExpected: true, // stale snapshot must lose here too
        expectedAssetIds,
      })
    ).toBe(false);
  });

  it("reads a DELETED asset from its snapshot, not the list", () => {
    // The deleted asset's id is empty, so the list can never match it. Without
    // the snapshot this row reports unexpected — the mislabel the snapshot
    // exists to prevent.
    expect(
      resolveScannedExpectedness({
        assetId: "",
        assetDeleted: true,
        isExpected: true,
        expectedAssetIds,
      })
    ).toBe(true);
  });

  it("still reports a deleted UNEXPECTED scan as unexpected", () => {
    // why the pair: without this, "deleted means expected" would pass above.
    expect(
      resolveScannedExpectedness({
        assetId: "",
        assetDeleted: true,
        isExpected: false,
        expectedAssetIds,
      })
    ).toBe(false);
  });

  it("treats a deleted row with no snapshot as unexpected", () => {
    // A scan recorded before the snapshot columns existed, whose asset is now
    // gone. Nothing can classify it; unexpected is the honest floor.
    expect(
      resolveScannedExpectedness({
        assetId: "",
        assetDeleted: true,
        isExpected: undefined,
        expectedAssetIds,
      })
    ).toBe(false);
  });

  it("does not let an empty id match an empty entry in the list", () => {
    // Guards the truthiness check: a stray "" in the expected list must not
    // make every unclassifiable row read as expected.
    expect(
      resolveScannedExpectedness({
        assetId: "",
        assetDeleted: false,
        isExpected: undefined,
        expectedAssetIds: new Set([""]),
      })
    ).toBe(false);
  });
});
