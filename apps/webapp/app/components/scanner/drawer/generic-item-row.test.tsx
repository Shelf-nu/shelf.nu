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

/**
 * A scan draft puts a parked list back as bare codes, and each row looks its
 * code up again. Those lookups must not be recorded as scans: nobody scanned
 * the codes just now. A restored row therefore marks its lookup, and a fresh
 * scan does not.
 *
 * @see {@link file://../../../utils/restored-scan-lookup.ts}
 */
describe("GenericItemRow lookups for rows restored from a scan draft", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          qr: { type: "asset", asset: { id: "asset-1", title: "Camera" } },
        }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The URL of the one lookup the row made. */
  async function requestedUrl() {
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    return new URL(String(mockFetch.mock.calls[0][0]), "http://localhost");
  }

  it("marks the lookup of a restored QR row", async () => {
    const store = createStore();
    store.set(scannedItemsAtom, {
      "qr-1": { codeType: "qr", pendingLookup: true },
    });
    renderRow(store);

    const url = await requestedUrl();
    expect(url.pathname).toBe("/api/get-scanned-item/qr-1");
    expect(url.searchParams.get("restored")).toBe("1");
  });

  it("marks the lookup of a restored barcode row", async () => {
    const store = createStore();
    store.set(scannedItemsAtom, {
      "qr-1": { codeType: "barcode", pendingLookup: true },
    });
    renderRow(store);

    const url = await requestedUrl();
    expect(url.pathname).toBe("/api/get-scanned-barcode/qr-1");
    expect(url.searchParams.get("restored")).toBe("1");
  });

  it("leaves a freshly scanned code's lookup unmarked, so it is recorded", async () => {
    const store = createStore();
    store.set(scannedItemsAtom, { "qr-1": { codeType: "qr" } });
    renderRow(store);

    const url = await requestedUrl();
    expect(url.searchParams.has("restored")).toBe(false);
  });

  it("keeps the drawer's own params next to the mark", async () => {
    const store = createStore();
    store.set(scannedItemsAtom, {
      "qr-1": { codeType: "qr", pendingLookup: true },
    });
    renderRow(store, { searchParams: { auditSessionId: "audit-1" } });

    const url = await requestedUrl();
    expect(url.searchParams.get("auditSessionId")).toBe("audit-1");
    expect(url.searchParams.get("restored")).toBe("1");
  });
});

/**
 * What a failed lookup leaves on the row decides whether a scan draft keeps
 * the code. A refusal of the code (4xx) is final. A server failure (5xx) or no
 * answer at all says nothing about the code, so it stays owed a lookup.
 */
describe("GenericItemRow failed lookups", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seed(store: ReturnType<typeof createStore>) {
    store.set(scannedItemsAtom, {
      "qr-1": { codeType: "barcode", pendingLookup: true },
    });
  }

  it("lets go of a code the server refuses", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 404,
      json: () =>
        Promise.resolve({ error: { message: "This barcode doesn't exist" } }),
    });
    const store = createStore();
    seed(store);
    renderRow(store);

    await waitFor(() => {
      expect(store.get(scannedItemsAtom)["qr-1"]).toEqual({
        error: "This barcode doesn't exist",
      });
    });
  });

  it("keeps a code whose lookup hit a server failure, to look it up later", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 500,
      json: () =>
        Promise.resolve({ error: { message: "Something went wrong" } }),
    });
    const store = createStore();
    seed(store);
    renderRow(store);

    await waitFor(() => {
      expect(store.get(scannedItemsAtom)["qr-1"]).toEqual({
        error: "Something went wrong",
        pendingLookup: true,
        codeType: "barcode",
      });
    });
  });

  it("keeps a code, and how it was scanned, when the lookup got no answer", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const store = createStore();
    seed(store);
    renderRow(store);

    await waitFor(() => {
      expect(store.get(scannedItemsAtom)["qr-1"]).toEqual({
        error: "Failed to fetch item",
        pendingLookup: true,
        codeType: "barcode",
      });
    });
  });
});
