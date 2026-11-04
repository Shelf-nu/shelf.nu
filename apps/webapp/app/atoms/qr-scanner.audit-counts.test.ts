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
  mergeAuditCountsAtom,
  setAuditExpectedAssetsAtom,
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
