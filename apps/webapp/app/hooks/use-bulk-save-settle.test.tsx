/**
 * Behaviour tests for how a bulk scanner save sent in parts (assets, kits)
 * settles the list, its draft's mark, and the result dialog's "Done".
 *
 * @see {@link file://./use-bulk-save-settle.ts}
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type { ScanListItem, ScanListItems } from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import type { BulkPartStatuses } from "./use-bulk-save-settle";
import {
  dismissBulkSave,
  settleBulkSave,
  useBulkSaveSettle,
} from "./use-bulk-save-settle";
import { unconfirmedScanSaveAtom } from "./use-scan-draft";

function row(id: string, type: "asset" | "kit"): ScanListItem {
  return { data: { id }, type, codeType: "qr" } as unknown as ScanListItem;
}

/** Two assets and a kit, as scanned. */
const ITEMS: ScanListItems = {
  "qr-a1": row("a1", "asset"),
  "qr-a2": row("a2", "asset"),
  "qr-k1": row("k1", "kit"),
};
const SUBMITTED = { assetIds: ["a1", "a2"], kitIds: ["k1"] };

function settle(statuses: BulkPartStatuses, noAnswer = false) {
  return settleBulkSave({
    statuses,
    noAnswer,
    items: ITEMS,
    submitted: SUBMITTED,
  });
}

describe("settleBulkSave", () => {
  it("waits while a part has not answered", () => {
    expect(settle({ assets: "success", kits: "processing" })).toBeNull();
  });

  it("leaves a fully saved list to the dialog's Done", () => {
    expect(settle({ assets: "success", kits: "skipped" })).toEqual({
      answer: "saved",
      rowsToRemove: [],
    });
  });

  it("takes the saved assets out when the kits are refused", () => {
    expect(settle({ assets: "success", kits: "error" })).toEqual({
      answer: "refused",
      rowsToRemove: ["qr-a1", "qr-a2"],
    });
  });

  it("takes the saved kits out when the assets are refused", () => {
    expect(settle({ assets: "error", kits: "success" })).toEqual({
      answer: "refused",
      rowsToRemove: ["qr-k1"],
    });
  });

  it("keeps the mark when the unsaved part got no answer", () => {
    expect(settle({ assets: "success", kits: "error" }, true)).toEqual({
      answer: "unanswered",
      rowsToRemove: ["qr-a1", "qr-a2"],
    });
  });

  it("keeps the whole list when nothing saved", () => {
    expect(settle({ assets: "error", kits: "error" })).toEqual({
      answer: "refused",
      rowsToRemove: [],
    });
  });
});

describe("dismissBulkSave", () => {
  const dismiss = (statuses: BulkPartStatuses) =>
    dismissBulkSave({ statuses, items: ITEMS, submitted: SUBMITTED });

  it("empties the list once all of it saved", () => {
    expect(dismiss({ assets: "skipped", kits: "success" })).toEqual({
      clearList: true,
      rowsToRemove: [],
    });
  });

  it("takes out a saved part when Done is pressed mid-save", () => {
    expect(dismiss({ assets: "success", kits: "processing" })).toEqual({
      clearList: false,
      rowsToRemove: ["qr-a1", "qr-a2"],
    });
  });

  it("keeps a refused list", () => {
    expect(dismiss({ assets: "error", kits: "error" })).toEqual({
      clearList: false,
      rowsToRemove: [],
    });
  });
});

describe("useBulkSaveSettle", () => {
  function render(store: ReturnType<typeof createStore>) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    return renderHook(
      (props: { statuses: BulkPartStatuses; dialogOpen: boolean }) =>
        useBulkSaveSettle(props),
      {
        wrapper,
        initialProps: {
          statuses: { assets: "processing", kits: "processing" },
          dialogOpen: false,
        },
      }
    );
  }

  it("marks the list as sent and takes out only the part that saved", () => {
    const store = createStore();
    store.set(scannedItemsAtom, ITEMS);
    const { result, rerender } = render(store);

    act(() => {
      result.current.begin(SUBMITTED);
    });
    expect(store.get(unconfirmedScanSaveAtom)).toBe(true);

    rerender({
      statuses: { assets: "success", kits: "error" },
      dialogOpen: true,
    });

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-k1"]);
    // The kits were refused: nothing of what is left was saved.
    expect(store.get(unconfirmedScanSaveAtom)).toBe(false);
  });

  it("keeps the mark when a part got no answer", () => {
    const store = createStore();
    store.set(scannedItemsAtom, ITEMS);
    const { result, rerender } = render(store);

    act(() => {
      result.current.begin(SUBMITTED).markUnanswered();
    });
    rerender({
      statuses: { assets: "success", kits: "error" },
      dialogOpen: true,
    });

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-k1"]);
    expect(store.get(unconfirmedScanSaveAtom)).toBe(true);
  });

  it("ignores an answer that arrives after Done", () => {
    const store = createStore();
    store.set(scannedItemsAtom, ITEMS);
    const { result } = render(store);

    let attempt = { isCurrent: () => true, markUnanswered: () => {} };
    act(() => {
      attempt = result.current.begin(SUBMITTED);
    });
    act(() => {
      result.current.dismiss();
    });

    expect(attempt.isCurrent()).toBe(false);
    // Nothing had answered: the whole list stays.
    expect(Object.keys(store.get(scannedItemsAtom))).toHaveLength(3);
  });

  it("empties the list on Done once all of it saved", () => {
    const store = createStore();
    store.set(scannedItemsAtom, ITEMS);
    const { result, rerender } = render(store);

    act(() => {
      result.current.begin(SUBMITTED);
    });
    rerender({
      statuses: { assets: "success", kits: "success" },
      dialogOpen: true,
    });
    expect(Object.keys(store.get(scannedItemsAtom))).toHaveLength(3);

    act(() => {
      result.current.dismiss();
    });
    expect(store.get(scannedItemsAtom)).toEqual({});
  });
});
