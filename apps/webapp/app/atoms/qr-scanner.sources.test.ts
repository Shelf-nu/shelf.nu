/**
 * Unit tests for the scanner's per-asset "From location" picks.
 *
 * A picked source lives in `scannedAssetSourcesAtom`, keyed by asset id, next
 * to the per-asset quantity. Every path that takes an asset off the scan list
 * must drop both, or a rescan of the same asset reuses a pick the operator
 * made for the removed row instead of the pre-selected location.
 *
 * Uses `createStore()` from `jotai/vanilla` so each test runs against an
 * isolated atom tree.
 *
 * @see {@link file://./qr-scanner.ts}
 */

import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import type { ScanListItems } from "./qr-scanner";
import {
  clearScannedItemsAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemAtom,
  removeScannedItemsByAssetIdAtom,
  scannedAssetQuantitiesAtom,
  scannedAssetSourcesAtom,
  scannedItemsAtom,
  setScannedAssetQuantityAtom,
  setScannedAssetSourceAtom,
} from "./qr-scanner";

let store: ReturnType<typeof createStore>;

/** Two scanned pools, each with a quantity and a picked source. */
function seedTwoPools() {
  store.set(scannedItemsAtom, {
    "qr-a": { type: "asset", data: { id: "pool-a" } },
    "qr-b": { type: "asset", data: { id: "pool-b" } },
  } as unknown as ScanListItems);
  store.set(setScannedAssetQuantityAtom, { assetId: "pool-a", quantity: 2 });
  store.set(setScannedAssetQuantityAtom, { assetId: "pool-b", quantity: 3 });
  store.set(setScannedAssetSourceAtom, { assetId: "pool-a", source: "loc-1" });
  store.set(setScannedAssetSourceAtom, {
    assetId: "pool-b",
    source: "unplaced",
  });
}

beforeEach(() => {
  store = createStore();
  seedTwoPools();
});

describe("removing a scanned asset drops its picked source", () => {
  it("by qr id", () => {
    store.set(removeScannedItemAtom, "qr-a");

    expect(store.get(scannedAssetSourcesAtom)).toEqual({
      "pool-b": "unplaced",
    });
    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "pool-b": 3 });
  });

  it("by several qr ids", () => {
    store.set(removeMultipleScannedItemsAtom, ["qr-a", "qr-b"]);

    expect(store.get(scannedAssetSourcesAtom)).toEqual({});
    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({});
  });

  it("by asset id", () => {
    store.set(removeScannedItemsByAssetIdAtom, ["pool-b"]);

    expect(store.get(scannedAssetSourcesAtom)).toEqual({ "pool-a": "loc-1" });
    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "pool-a": 2 });
  });

  it("when the list is cleared", () => {
    store.set(clearScannedItemsAtom);

    expect(store.get(scannedAssetSourcesAtom)).toEqual({});
    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({});
  });
});
