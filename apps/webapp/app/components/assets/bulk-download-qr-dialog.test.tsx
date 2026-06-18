/**
 * Regression tests for {@link BulkDownloadQrDialog}.
 *
 * The dialog is permanently mounted on the asset index (only the `isDialogOpen`
 * prop toggles), so its fetch state survives the user closing it, changing the
 * active filter/selection, and reopening it. Two distinct bugs are guarded here:
 *
 * 1. Stale-cache reuse: a second "Download QR codes" after a filter change must
 *    fetch fresh data for the now-current filters, not reuse the first response.
 * 2. Superseded slow response: dismissing the loading dialog mid-fetch and
 *    starting a new download must NOT let the first (slow) response complete and
 *    zip the previous filter's assets — the newest request always wins.
 *
 * Observable, implementation-agnostic signals: each download issues a fetch
 * whose URL reflects the then-current params, and only the latest request's
 * assets are ever rasterized into the zip.
 *
 * @see {@link file://./bulk-download-qr-dialog.tsx}
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
 * - `searchParams`: what the mocked `useSearchParams` returns (the active filter)
 * - `renderedTitles`: titles of every asset actually rasterized into a zip, so a
 *   test can assert which request's assets were processed.
 */
const hoisted = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  renderedTitles: [] as string[],
}));

// why: the dialog imports `useSearchParams` from this cookie/org-context-aware
// wrapper; in a unit test we only need it to surface the current filter params
// so the dialog folds them into the request URL.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [hoisted.searchParams, vi.fn()] as const,
}));

// why: replace only `useLoaderData` so the dialog reads a small `totalItems`
// (keeping the "more than 100" branch off) without running a real route loader.
vi.mock("react-router", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, useLoaderData: () => ({ totalItems: 5 }) };
});

// why: happy-dom cannot rasterize a DOM node to an image, so html-to-image's
// toBlob would throw. Resolve a tiny blob so the download path completes.
vi.mock("html-to-image", () => ({
  toBlob: vi.fn(() => Promise.resolve(new Blob(["x"], { type: "image/jpeg" }))),
}));

// why: avoids rendering <QrLabel> via renderToStaticMarkup (pulls in QR-codec
// deps irrelevant to this test). It also records the title of each asset that
// reaches rasterization, which is how the race test proves WHICH request's
// assets were zipped.
vi.mock("~/utils/component-to-html", () => ({
  generateHtmlFromComponent: (element: { props?: { title?: string } }) => {
    if (element?.props?.title) hoisted.renderedTitles.push(element.props.title);
    return document.createElement("div");
  },
}));

// why: QrLabel is only ever passed to the (mocked) generateHtmlFromComponent,
// never rendered here, and its module chain (AddBarcodeDialog -> scan-barcode-tab
// -> scanner -> lottie-web) touches canvas at import time and crashes under
// happy-dom. A stub cuts that chain.
vi.mock("~/components/code-preview/code-preview", () => ({
  QrLabel: (props: { title?: string }) => props as unknown as null,
}));

// why: zip generation is irrelevant to the assertions and its Blob plumbing is
// unreliable under happy-dom; a no-op archive lets processDownload reach its
// success state deterministically.
vi.mock("jszip", () => {
  class FakeZip {
    folder() {
      return { file: () => undefined };
    }
    file() {
      return undefined;
    }
    generateAsync() {
      return Promise.resolve(new Blob(["zip"]));
    }
  }
  return { default: FakeZip };
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
      sequentialId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      qr: {
        id: `qr-${id}`,
        src: "data:image/png;base64,xxx",
        size: "medium" as const,
      },
    })),
    qrIdDisplayPreference: "QR_ID",
    showShelfBranding: true,
  };
}

beforeEach(() => {
  fetchControl.mode = "auto";
  fetchControl.pending = [];
  hoisted.searchParams = new URLSearchParams();
  hoisted.renderedTitles = [];

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

  // why: happy-dom does not implement object URLs; processDownload calls both.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Renders the dialog under a dedicated jotai store (so selection state persists
 * across rerenders) with the dialog kept open for the whole test — both bugs
 * only reproduce while component state survives close/reopen.
 */
function renderDialog() {
  const store = createStore();
  const onClose = vi.fn();
  const utils = render(
    <Provider store={store}>
      <BulkDownloadQrDialog isDialogOpen onClose={onClose} />
    </Provider>
  );
  return { store, onClose, ...utils };
}

/** Sets the active filter params + selected assets, flushing React effects. */
async function setFilterAndSelection(
  store: ReturnType<typeof createStore>,
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
  it("refetches with the current params on a second download after filters change", async () => {
    const user = userEvent.setup();
    const { store } = renderDialog();

    /* ---------- Download #1: category A, assets a1 + a2 ---------- */
    await setFilterAndSelection(store, "category=cat-A", ["a1", "a2"]);

    await user.click(await screen.findByRole("button", { name: "Download" }));
    await screen.findByText(/successfully downloaded qr codes/i);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstUrl = fetchSpy.mock.calls[0][0] as string;
    expect(firstUrl).toContain("category=cat-A");
    expect(firstUrl).toContain("assetIds=a1");
    expect(firstUrl).toContain("assetIds=a2");

    /* ---------- Close to re-show the Download button (state persists) ---------- */
    await user.click(screen.getByRole("button", { name: "Close" }));

    /* ---------- Change filter to tag A, assets b9 ---------- */
    await setFilterAndSelection(store, "tag=tag-A", ["b9"]);

    /* ---------- Download #2 ---------- */
    await user.click(await screen.findByRole("button", { name: "Download" }));

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

  it("ignores a slow superseded response and only zips the latest request's assets", async () => {
    // Manually control fetch resolution to simulate a slow first request that
    // resolves AFTER the user dismissed it and started a second download.
    fetchControl.mode = "manual";
    const user = userEvent.setup();
    const { store } = renderDialog();

    /* ---------- Download #1: category A (will resolve LATE) ---------- */
    await setFilterAndSelection(store, "category=cat-A", ["a1", "a2"]);
    await user.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(fetchControl.pending).toHaveLength(1));

    /* ---------- Dismiss the loading dialog mid-flight via the header X ---------- */
    // The header close button is not gated by the loading state (unlike the body
    // Close/Download buttons), so it — like Escape/backdrop — can cancel an
    // in-flight download.
    await user.click(screen.getByRole("button", { name: /close dialog/i }));

    /* ---------- Download #2: tag A (the current request) ---------- */
    await setFilterAndSelection(store, "tag=tag-A", ["b9"]);
    await user.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(fetchControl.pending).toHaveLength(2));

    /* ---------- The superseded request resolves FIRST, then the current one ---------- */
    await act(async () => {
      fetchControl.pending[0].resolve(payloadFor(["a1", "a2"]));
      await Promise.resolve();
    });
    await act(async () => {
      fetchControl.pending[1].resolve(payloadFor(["b9"]));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        screen.getByText(/successfully downloaded qr codes/i)
      ).toBeInTheDocument()
    );

    // Only the latest request's assets are rasterized; the stale ones never are.
    expect(hoisted.renderedTitles).toContain("Asset b9");
    expect(hoisted.renderedTitles).not.toContain("Asset a1");
    expect(hoisted.renderedTitles).not.toContain("Asset a2");
  });
});
