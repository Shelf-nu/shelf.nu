/**
 * Unit tests for the booking partial-checkin and partial-checkout atoms.
 *
 * Contract-level coverage for:
 *  - `quickCheckinQtyAssetAtom` — synthesizes a scanned-item entry for a
 *    pending QUANTITY_TRACKED asset so the rest of the check-in drawer
 *    treats it like a real scan.
 *  - `quickCheckoutQtyAssetAtom` — direction-twin for the partial-checkout
 *    drawer; same shape under a distinct synthetic-key prefix.
 *  - Idempotency of the quick-checkin / quick-checkout dispatches.
 *  - Round-trip removal via `removeScannedItemAtom` keyed on the
 *    synthetic prefix (both directions).
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
  QUICK_CHECKOUT_QR_PREFIX,
  quickCheckinQtyAssetAtom,
  quickCheckoutQtyAssetAtom,
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
    bookingAssetId: "ba-qty-1",
    title: "Battery pack",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    booked: 20,
    logged: 0,
    remaining: 20,
    breakdown: { returned: 0, consumed: 0, lost: 0, damaged: 0 },
    consumptionType: "TWO_WAY",
    ...overrides,
  };
}

describe("quickCheckinQtyAssetAtom", () => {
  it("inserts a synthetic-keyed entry into scannedItemsAtom", () => {
    const store = createStore();
    const asset = qtyAsset({
      id: "asset-qty-42",
      bookingAssetId: "ba-qty-42",
      consumptionType: "ONE_WAY",
    });

    store.set(quickCheckinQtyAssetAtom, asset);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);

    expect(keys).toHaveLength(1);
    // Polish-7b: keyed by the slice (bookingAssetId), not asset.id.
    const expectedKey = `${QUICK_CHECKIN_QR_PREFIX}${asset.bookingAssetId}`;
    expect(keys[0]).toBe(expectedKey);

    const entry = items[expectedKey];
    expect(entry?.type).toBe("asset");
    expect(entry?.codeType).toBe("qr");
    // Data is cast through `unknown` in the atom — the behaviour contract
    // is that `id`, `bookingAssetId` and `consumptionType` survive the
    // round-trip so the drawer can look them up.
    expect((entry?.data as { id?: string } | undefined)?.id).toBe(asset.id);
    expect(
      (entry?.data as { bookingAssetId?: string } | undefined)?.bookingAssetId
    ).toBe(asset.bookingAssetId);
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
    const key = `${QUICK_CHECKIN_QR_PREFIX}${asset.bookingAssetId}`;

    store.set(quickCheckinQtyAssetAtom, asset);
    expect(Object.keys(store.get(scannedItemsAtom))).toContain(key);

    store.set(removeScannedItemAtom, key);

    const items = store.get(scannedItemsAtom);
    expect(Object.keys(items)).toHaveLength(0);
    expect(items[key]).toBeUndefined();
  });
});

describe("quickCheckoutQtyAssetAtom", () => {
  it("inserts a synthetic-keyed entry into scannedItemsAtom", () => {
    const store = createStore();
    const asset = qtyAsset({
      id: "asset-qty-42",
      bookingAssetId: "ba-qty-42",
      consumptionType: "ONE_WAY",
    });

    store.set(quickCheckoutQtyAssetAtom, asset);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);

    expect(keys).toHaveLength(1);
    // Keyed by the slice (bookingAssetId), not asset.id — matches the
    // check-in twin's contract so multi-slice bookings can quick-check-out
    // each slice independently.
    const expectedKey = `${QUICK_CHECKOUT_QR_PREFIX}${asset.bookingAssetId}`;
    expect(keys[0]).toBe(expectedKey);

    const entry = items[expectedKey];
    expect(entry?.type).toBe("asset");
    expect(entry?.codeType).toBe("qr");
    // Data is cast through `unknown` in the atom — the behaviour contract
    // is that `id`, `bookingAssetId` and `consumptionType` survive the
    // round-trip so the checkout drawer can look them up.
    expect((entry?.data as { id?: string } | undefined)?.id).toBe(asset.id);
    expect(
      (entry?.data as { bookingAssetId?: string } | undefined)?.bookingAssetId
    ).toBe(asset.bookingAssetId);
    expect(
      (entry?.data as { consumptionType?: string } | undefined)?.consumptionType
    ).toBe("ONE_WAY");
  });

  it("is idempotent — a second dispatch for the same asset is a no-op", () => {
    const store = createStore();
    const asset = qtyAsset({ id: "asset-qty-idem" });

    store.set(quickCheckoutQtyAssetAtom, asset);
    const firstSnapshot = store.get(scannedItemsAtom);
    const firstKeys = Object.keys(firstSnapshot);

    store.set(quickCheckoutQtyAssetAtom, asset);
    const secondSnapshot = store.get(scannedItemsAtom);
    const secondKeys = Object.keys(secondSnapshot);

    expect(firstKeys).toHaveLength(1);
    expect(secondKeys).toHaveLength(1);
    expect(secondKeys[0]).toBe(firstKeys[0]);
  });

  it("round-trips cleanly with removeScannedItemAtom", () => {
    const store = createStore();
    const asset = qtyAsset({ id: "asset-qty-round-trip" });
    const key = `${QUICK_CHECKOUT_QR_PREFIX}${asset.bookingAssetId}`;

    store.set(quickCheckoutQtyAssetAtom, asset);
    expect(Object.keys(store.get(scannedItemsAtom))).toContain(key);

    store.set(removeScannedItemAtom, key);

    const items = store.get(scannedItemsAtom);
    expect(Object.keys(items)).toHaveLength(0);
    expect(items[key]).toBeUndefined();
  });

  it("uses a distinct prefix from the check-in twin so keys don't collide", () => {
    // The two atoms write to the same `scannedItemsAtom` substrate;
    // distinct prefixes are what keeps the drawer-side `isQuickCheckin`
    // vs `isQuickCheckout` probes deterministic.
    const store = createStore();
    const asset = qtyAsset({
      id: "asset-qty-distinct",
      bookingAssetId: "ba-qty-distinct",
    });

    store.set(quickCheckinQtyAssetAtom, asset);
    store.set(quickCheckoutQtyAssetAtom, asset);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);

    expect(keys).toHaveLength(2);
    expect(keys).toContain(`${QUICK_CHECKIN_QR_PREFIX}${asset.bookingAssetId}`);
    expect(keys).toContain(
      `${QUICK_CHECKOUT_QR_PREFIX}${asset.bookingAssetId}`
    );
    expect(QUICK_CHECKIN_QR_PREFIX).not.toBe(QUICK_CHECKOUT_QR_PREFIX);
  });
});
