/**
 * Unit tests for the booking partial-checkin atoms.
 *
 * Contract-level coverage for:
 *  - `quickCheckinQtyAssetAtom` — synthesizes a scanned-item entry for a
 *    pending QUANTITY_TRACKED asset so the rest of the drawer treats it
 *    like a real scan.
 *  - Idempotency of the quick-checkin dispatch.
 *  - Round-trip removal via `removeScannedItemAtom` keyed on the
 *    synthetic prefix.
 *
 * Uses `createStore()` from `jotai/vanilla` so each test runs against an
 * isolated atom tree — no shared global state between cases.
 *
 * @see {@link file://./qr-scanner.ts}
 */

import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type { BookingExpectedAsset } from "./qr-scanner";
import {
  QUICK_CHECKIN_QR_PREFIX,
  quickCheckinQtyAssetAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
} from "./qr-scanner";

/**
 * Build a QUANTITY_TRACKED expected-asset fixture. The narrowed type is
 * what `quickCheckinQtyAssetAtom` requires.
 */
function qtyAsset(
  overrides: Partial<
    Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }>
  >
): Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }> {
  return {
    kind: "QUANTITY_TRACKED",
    id: "asset-qty-1",
    title: "Battery pack",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    booked: 20,
    logged: 0,
    remaining: 20,
    consumptionType: "TWO_WAY",
    ...overrides,
  };
}

describe("quickCheckinQtyAssetAtom", () => {
  it("inserts a synthetic-keyed entry into scannedItemsAtom", () => {
    const store = createStore();
    const asset = qtyAsset({
      id: "asset-qty-42",
      consumptionType: "ONE_WAY",
    });

    store.set(quickCheckinQtyAssetAtom, asset);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);

    expect(keys).toHaveLength(1);
    const expectedKey = `${QUICK_CHECKIN_QR_PREFIX}${asset.id}`;
    expect(keys[0]).toBe(expectedKey);

    const entry = items[expectedKey];
    expect(entry?.type).toBe("asset");
    expect(entry?.codeType).toBe("qr");
    // Data is cast through `unknown` in the atom — the behaviour contract
    // is that `id` and `consumptionType` survive the round-trip so the
    // drawer can look them up.
    expect((entry?.data as { id?: string } | undefined)?.id).toBe(asset.id);
    expect(
      (entry?.data as { consumptionType?: string } | undefined)?.consumptionType
    ).toBe("ONE_WAY");
  });

  it("is idempotent — a second dispatch for the same asset is a no-op", () => {
    const store = createStore();
    const asset = qtyAsset({ id: "asset-qty-idem" });

    store.set(quickCheckinQtyAssetAtom, asset);
    const firstSnapshot = store.get(scannedItemsAtom);
    const firstKeys = Object.keys(firstSnapshot);

    store.set(quickCheckinQtyAssetAtom, asset);
    const secondSnapshot = store.get(scannedItemsAtom);
    const secondKeys = Object.keys(secondSnapshot);

    expect(firstKeys).toHaveLength(1);
    expect(secondKeys).toHaveLength(1);
    expect(secondKeys[0]).toBe(firstKeys[0]);
  });

  it("round-trips cleanly with removeScannedItemAtom", () => {
    const store = createStore();
    const asset = qtyAsset({ id: "asset-qty-round-trip" });
    const key = `${QUICK_CHECKIN_QR_PREFIX}${asset.id}`;

    store.set(quickCheckinQtyAssetAtom, asset);
    expect(Object.keys(store.get(scannedItemsAtom))).toContain(key);

    store.set(removeScannedItemAtom, key);

    const items = store.get(scannedItemsAtom);
    expect(Object.keys(items)).toHaveLength(0);
    expect(items[key]).toBeUndefined();
  });
});
