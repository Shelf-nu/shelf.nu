/**
 * Regression tests for {@link BulkDownloadQrDialog}.
 *
 * The dialog is permanently mounted on the asset index (only the `isDialogOpen`
 * prop toggles), so its fetch state survives the user closing it, changing the
 * active filter/selection, and reopening it. Two distinct bugs are guarded here:
 *
 * 1. Stale-cache reuse: a second export after a filter change must fetch fresh
 *    data for the now-current filters, not reuse the first response.
 * 2. Superseded slow response: dismissing the dialog mid-fetch and reopening it
 *    on a new selection must NOT let the first (slow) response complete and
 *    label the previous filter's assets — the newest request always wins.
 *
 * Observable, implementation-agnostic signals: each export issues a fetch whose
 * URL reflects the then-current params, and only the latest request's assets
 * ever reach the printable sheet.
 *
 * @see {@link file://./bulk-download-qr-dialog.tsx}
 * @see {@link file://./../../hooks/use-api-query.ts}
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { ListItemData } from "~/components/list/list-item";
import type { BulkQrDownloadLoaderData } from "~/routes/api+/assets.get-assets-for-bulk-qr-download";
import BulkDownloadQrDialog from "./bulk-download-qr-dialog";

/**
 * Hoisted, mutable state read by the (hoisted) `vi.mock` factories:
 * `searchParams` is what the mocked `useSearchParams` returns — the active
 * filter the dialog folds into its request URL.
 */
const hoisted = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

// why: the dialog imports `useSearchParams` from this cookie/org-context-aware
// wrapper; in a unit test we only need it to surface the current filter params.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [hoisted.searchParams, vi.fn()] as const,
}));

// why: replace only `useLoaderData` so the dialog reads the export entitlement
// off the asset-index loader without running a real route loader. `false` here
// would render the upsell instead of ever fetching.
vi.mock("react-router", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, useLoaderData: () => ({ canExportAssets: true }) };
});

/** Records every URL the dialog requests. */
const fetchSpy = vi.fn();

/**
 * Controls how the mocked `fetch` resolves:
 * - "auto": resolve immediately with a payload matching the URL's assetIds.
 * - "manual": defer; the test resolves `pending[i]` by hand to control ordering.
 */
const fetchControl = {
  mode: "auto" as "auto" | "manual",
  pending: [] as Array<{
    url: string;
    resolve: (data: BulkQrDownloadLoaderData) => void;
  }>,
};

/** Builds a valid loader payload whose assets match the requested ids. */
function payloadFor(assetIds: string[]): BulkQrDownloadLoaderData {
  return {
    assets: assetIds.map((id) => ({
      id,
      title: `Asset ${id}`,
      qrId: `qr-${id}`,
      idText: `SAM-${id}`,
    })),
    qrBaseUrl: "https://eam.sh",
    showBranding: true,
  };
}

beforeEach(() => {
  fetchControl.mode = "auto";
  fetchControl.pending = [];
  hoisted.searchParams = new URLSearchParams();

  // why: install the fetch spy AFTER MSW's interception (mirrors
  // use-api-query.test.ts) so the dialog's request is captured here and never
  // reaches MSW (which errors on unhandled requests).
  vi.spyOn(globalThis, "fetch").mockImplementation(((
    input: RequestInfo | URL
  ) => {
    const url = String(input);
    fetchSpy(url);
    const ids = new URL(url, "http://localhost").searchParams.getAll(
      "assetIds"
    );
    if (fetchControl.mode === "manual") {
      return new Promise<Response>((resolve) => {
        fetchControl.pending.push({
          url,
          resolve: (data) =>
            resolve({ json: () => Promise.resolve(data) } as Response),
        });
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve(payloadFor(ids)),
    } as Response);
  }) as typeof fetch);
  fetchSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Store = ReturnType<typeof createStore>;

/**
 * The dialog as the asset index mounts it: permanently rendered, with only
 * `isDialogOpen` toggling. Both bugs only reproduce while component state
 * survives a close/reopen.
 */
function Harness({ store, open }: { store: Store; open: boolean }) {
  return (
    <Provider store={store}>
      <BulkDownloadQrDialog isDialogOpen={open} onClose={() => {}} />
    </Provider>
  );
}

function renderDialog() {
  const store = createStore();
  const { rerender } = render(<Harness store={store} open />);
  return {
    store,
    setOpen: (open: boolean) => rerender(<Harness store={store} open={open} />),
  };
}

/** Sets the active filter params + selected assets, flushing React effects. */
async function setFilterAndSelection(
  store: Store,
  filterQuery: string,
  assetIds: string[]
) {
  hoisted.searchParams = new URLSearchParams(filterQuery);
  await act(async () => {
    store.set(
      selectedBulkItemsAtom,
      assetIds.map((id) => ({ id }) as unknown as ListItemData)
    );
    // Flush microtask-scheduled effects (useMemo recompute) so the dialog
    // observes the new filter + selection before we interact with it.
    await Promise.resolve();
  });
}

describe("BulkDownloadQrDialog", () => {
  it("refetches with the current params on a second export after filters change", async () => {
    const { store, setOpen } = renderDialog();

    /* ---------- Export #1: category A, assets a1 + a2 ---------- */
    await setFilterAndSelection(store, "category=cat-A", ["a1", "a2"]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    expect(firstUrl).toContain("category=cat-A");
    expect(firstUrl).toContain("assetIds=a1");
    expect(firstUrl).toContain("assetIds=a2");

    /* ---------- Close, change filter to tag A / asset b9, reopen ---------- */
    await act(async () => {
      setOpen(false);
      await Promise.resolve();
    });
    await setFilterAndSelection(store, "tag=tag-A", ["b9"]);
    await act(async () => {
      setOpen(true);
      await Promise.resolve();
    });

    // Fixed code issues a fresh fetch for the new params; the original bug
    // reused the cached response and never fetched again.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const secondUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondUrl).toContain("tag=tag-A");
    expect(secondUrl).toContain("assetIds=b9");
    expect(secondUrl).not.toContain("category=cat-A");
    expect(secondUrl).not.toContain("assetIds=a1");
    expect(secondUrl).not.toEqual(firstUrl);
  });

  it("ignores a slow superseded response and only labels the latest request's assets", async () => {
    // Manually control fetch resolution to simulate a slow first request that
    // resolves AFTER the user dismissed it and started a second export.
    fetchControl.mode = "manual";
    const user = userEvent.setup();
    const { store, setOpen } = renderDialog();

    /* ---------- Export #1: category A (will resolve LATE) ---------- */
    await setFilterAndSelection(store, "category=cat-A", ["a1", "a2"]);
    await waitFor(() => expect(fetchControl.pending).toHaveLength(1));

    /* ---------- Dismiss mid-flight, then reopen on a new selection ---------- */
    await act(async () => {
      setOpen(false);
      await Promise.resolve();
    });
    await setFilterAndSelection(store, "tag=tag-A", ["b9"]);
    await act(async () => {
      setOpen(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchControl.pending).toHaveLength(2));

    /* ---------- The current request lands, THEN the slow superseded one ---------- */
    // This ordering is the whole point: last-writer-wins would leave the
    // previous filter's assets on screen. The mocked fetch deliberately ignores
    // `AbortSignal`, so what is under test is the hook's `ignore` flag, not the
    // browser cancelling the socket.
    await act(async () => {
      fetchControl.pending[1].resolve(payloadFor(["b9"]));
      await Promise.resolve();
    });
    await act(async () => {
      fetchControl.pending[0].resolve(payloadFor(["a1", "a2"]));
      await Promise.resolve();
    });

    // The count comes straight off the payload the dialog kept.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 4 }).textContent).toBe(
        "Make QR labels for 1 asset"
      )
    );

    // And the sheet itself is built from the latest request's assets only.
    // Queried by label text, not by role: the dialog backdrop is itself a
    // `role="button"`, so its accessible name contains every option's copy.
    await user.click(
      screen.getByText("Print on a regular printer").closest("button")!
    );
    expect(screen.getByAltText("QR label for Asset b9")).toBeTruthy();
    expect(screen.queryByAltText("QR label for Asset a1")).toBeNull();
    expect(screen.queryByAltText("QR label for Asset a2")).toBeNull();
  });
});
