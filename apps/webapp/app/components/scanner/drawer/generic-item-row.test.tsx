/**
 * Behavior tests for the `rejectItemType` guard on {@link GenericItemRow}.
 *
 * Audits are asset-only (kits have no `AuditAsset` record — see
 * `audit-drawer.tsx`), so the audit drawer passes `rejectItemType="kit"`
 * into `GenericItemRow`. These tests assert the guard's observable
 * behavior: a resolved kit item is stored as a plain `error` (never
 * `data`/`type`), so it renders through the loading/error path instead of
 * `renderItem` — no detail link, no clickable content — and can't enter a
 * `data`-driven persistence loop (see `use-audit-scan-persistence.ts`).
 *
 * A companion test confirms drawers that DON'T pass `rejectItemType`
 * (e.g. add-assets-to-kit-drawer) keep resolving kits normally.
 *
 * @see {@link file://./generic-item-row.tsx}
 * @see {@link file://../../audit/audit-drawer.tsx}
 */
import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider, useAtomValue } from "jotai";
import { createStore } from "jotai/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { GenericItemRow } from "./generic-item-row";

// why: testing the fetch → atom-write pipeline without a real network
// call. Installed via `spyOn` (not a module mock) so it takes effect
// after MSW 2's global fetch patch — matches the established pattern in
// `use-api-query.test.ts`.
const mockFetch = vi.fn();

type RowOverrides = Partial<
  Omit<ComponentProps<typeof GenericItemRow>, "qrId" | "item">
>;

/**
 * Mounts `GenericItemRow` behind a thin harness that reads `item` back
 * from `scannedItemsAtom` — mirroring how `AuditDrawer` (and every other
 * consumer) feeds the row its `item` prop from the shared atom. Without
 * this round-trip, the row would never observe the `setItem` write its
 * own fetch triggers.
 */
function renderRow(
  store: ReturnType<typeof createStore>,
  overrides: RowOverrides = {}
) {
  function Harness() {
    const items = useAtomValue(scannedItemsAtom);
    return (
      <table>
        <tbody>
          <GenericItemRow
            qrId="qr-1"
            item={items["qr-1"]}
            onRemove={vi.fn()}
            renderItem={() => <span>rendered item</span>}
            renderLoading={(qrId, error) => (
              <span data-testid="loading-row">
                {error ?? `loading ${qrId}`}
              </span>
            )}
            {...overrides}
          />
        </tbody>
      </table>
    );
  }

  return render(
    <Provider store={store}>
      <Harness />
    </Provider>
  );
}

describe("GenericItemRow rejectItemType", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores a resolved kit as an error item, not data, when rejectItemType matches", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          qr: { type: "kit", kit: { id: "kit-1", name: "Kit A" } },
        }),
    });

    const store = createStore();
    renderRow(store, {
      rejectItemType: "kit",
      rejectItemMessage:
        "Audits track assets, not kits — scan the kit's individual assets.",
    });

    await waitFor(() => {
      expect(store.get(scannedItemsAtom)["qr-1"]).toEqual({
        error:
          "Audits track assets, not kits — scan the kit's individual assets.",
      });
    });

    // Renders through the error/loading path, never the clickable item row.
    expect(screen.getByTestId("loading-row")).toHaveTextContent(
      "Audits track assets, not kits"
    );
    expect(screen.queryByText("rendered item")).not.toBeInTheDocument();
  });

  it("falls back to a generic message when rejectItemMessage is omitted", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          qr: { type: "kit", kit: { id: "kit-1", name: "Kit A" } },
        }),
    });

    const store = createStore();
    renderRow(store, { rejectItemType: "kit" });

    await waitFor(() => {
      const stored = store.get(scannedItemsAtom)["qr-1"];
      expect(stored?.error).toBeTruthy();
      expect(stored?.data).toBeUndefined();
    });
  });

  it("still resolves a kit normally when rejectItemType is not set (other drawers support kits)", async () => {
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          qr: { type: "kit", kit: { id: "kit-1", name: "Kit A" } },
        }),
    });

    const store = createStore();
    renderRow(store);

    await waitFor(() => {
      expect(store.get(scannedItemsAtom)["qr-1"]).toEqual({
        data: { id: "kit-1", name: "Kit A" },
        type: "kit",
        codeType: undefined,
      });
    });

    expect(await screen.findByText("rendered item")).toBeInTheDocument();
  });
});
