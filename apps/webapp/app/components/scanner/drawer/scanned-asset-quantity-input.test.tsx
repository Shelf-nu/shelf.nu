/**
 * The per-row quantity never offers more than the row can move. A quantity put
 * back from a scan draft, or kept while the pool shrank, is lowered to the
 * row's current cap as soon as the row shows it.
 *
 * @see {@link file://./scanned-asset-quantity-input.tsx}
 */
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import { scannedAssetQuantitiesAtom } from "~/atoms/qr-scanner";
import { ScannedAssetQuantityInput } from "./scanned-asset-quantity-input";

function renderInput(store: ReturnType<typeof createStore>, max: number) {
  return render(
    <Provider store={store}>
      <ScannedAssetQuantityInput assetId="pool-1" max={max} unit="units" />
    </Provider>
  );
}

describe("ScannedAssetQuantityInput", () => {
  it("lowers a stored quantity above the row's cap to the cap", () => {
    const store = createStore();
    store.set(scannedAssetQuantitiesAtom, { "pool-1": 12 });

    renderInput(store, 5);

    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "pool-1": 5 });
    expect(screen.getByLabelText("Quantity")).toHaveValue(5);
  });

  it("keeps a stored quantity that fits", () => {
    const store = createStore();
    store.set(scannedAssetQuantitiesAtom, { "pool-1": 3 });

    renderInput(store, 5);

    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "pool-1": 3 });
  });

  it("leaves the quantity alone when the row can move nothing", () => {
    const store = createStore();
    store.set(scannedAssetQuantitiesAtom, { "pool-1": 3 });

    renderInput(store, 0);

    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "pool-1": 3 });
  });

  it("stores nothing for a row left at its default", () => {
    const store = createStore();

    renderInput(store, 5);

    expect(store.get(scannedAssetQuantitiesAtom)).toEqual({});
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  });
});
