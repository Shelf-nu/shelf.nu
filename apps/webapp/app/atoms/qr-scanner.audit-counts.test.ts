/**
 * Unit tests for the audit count atoms.
 *
 * `auditCountsAtom` holds the count of each quantity-tracked asset in a
 * running web audit. The loader reseeds it on every revalidation; a count the
 * auditor just entered must survive that, and individual assets never get an
 * entry (the persistence hook reads an entry as "this scan needs a count").
 *
 * @see {@link file://./qr-scanner.ts}
 */

import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type { AuditScannedItem } from "./qr-scanner";
import {
  auditCountsAtom,
  auditCountsFromItems,
  lastDuplicateScanAtom,
  mergeAuditCountsAtom,
  scannedItemsAtom,
  setAuditExpectedAssetsAtom,
  updateScannedItemAtom,
} from "./qr-scanner";

/** An expected audit row as the scan route builds it. */
function row(overrides: Partial<AuditScannedItem>): AuditScannedItem {
  return {
    id: "pool-1",
    name: "Sandbag",
    type: "asset",
    auditStatus: "missing",
    ...overrides,
  };
}

describe("auditCountsFromItems", () => {
  it("gives quantity rows an entry and individual rows none", () => {
    expect(
      auditCountsFromItems([
        row({ expectedQuantity: 14, foundQuantity: 8, unitOfMeasure: "pcs" }),
        row({ id: "camera-1", expectedQuantity: null }),
      ])
    ).toEqual({
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 8,
        unitOfMeasure: "pcs",
      },
    });
  });
});

describe("setAuditExpectedAssetsAtom", () => {
  it("keeps a count entered here until the server has saved it", () => {
    const store = createStore();
    store.set(mergeAuditCountsAtom, {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 9,
        unitOfMeasure: "pcs",
        unsaved: true,
      },
    });

    store.set(setAuditExpectedAssetsAtom, [
      row({ expectedQuantity: 14, foundQuantity: 8, unitOfMeasure: "pcs" }),
    ]);

    expect(store.get(auditCountsAtom)["pool-1"].foundQuantity).toBe(9);
  });

  it("takes the loader's count over a saved local one", () => {
    // why: another auditor may have recounted; a saved local count is stale.
    const store = createStore();
    store.set(mergeAuditCountsAtom, {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 6,
        unitOfMeasure: "pcs",
      },
    });

    store.set(setAuditExpectedAssetsAtom, [
      row({ expectedQuantity: 14, foundQuantity: 8, unitOfMeasure: "pcs" }),
    ]);

    expect(store.get(auditCountsAtom)["pool-1"].foundQuantity).toBe(8);
  });

  it("takes the loader's count when there is none locally", () => {
    const store = createStore();

    store.set(setAuditExpectedAssetsAtom, [
      row({ expectedQuantity: 14, foundQuantity: 8, unitOfMeasure: "pcs" }),
    ]);

    expect(store.get(auditCountsAtom)["pool-1"]).toEqual({
      expectedQuantity: 14,
      foundQuantity: 8,
      unitOfMeasure: "pcs",
    });
  });
});

describe("updateScannedItemAtom, second code of a listed asset", () => {
  /** The listed pool and a store holding it under its QR code. */
  function storeWithListedPool() {
    const store = createStore();
    store.set(scannedItemsAtom, {
      "qr-1": {
        type: "asset",
        codeType: "qr",
        data: { id: "pool-1", title: "Sandbag" } as never,
      },
    });
    return store;
  }

  it("signals a duplicate that points at the listed row", () => {
    const store = storeWithListedPool();
    store.set(updateScannedItemAtom, {
      qrId: "bc-1",
      item: {
        type: "asset",
        codeType: "barcode",
        data: { id: "pool-1", title: "Sandbag" } as never,
      },
    });
    expect(store.get(lastDuplicateScanAtom)).toMatchObject({
      qrId: "qr-1",
      assetTitle: "Sandbag",
    });
  });

  it("does not signal a duplicate kit", () => {
    const store = createStore();
    store.set(scannedItemsAtom, {
      "qr-kit": { type: "kit", data: { id: "kit-1", name: "Kit" } as never },
    });
    store.set(updateScannedItemAtom, {
      qrId: "bc-kit",
      item: { type: "kit", data: { id: "kit-1", name: "Kit" } as never },
    });
    expect(store.get(lastDuplicateScanAtom)).toBeNull();
  });
});
