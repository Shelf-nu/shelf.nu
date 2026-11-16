/**
 * Behaviour tests for the scan draft of the scanners that have no session hook
 * of their own: the kit scanner, the location scanner and the bulk actions.
 *
 * Each keeps its own draft: the list has to outlive the page (a reload, an
 * error page), must stay when a save gets no answer, must go once a save is
 * accepted, and must never surface in another scanner.
 *
 * @see {@link file://./use-scan-draft.ts}
 */
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanListItem } from "~/atoms/qr-scanner";
import {
  scannedAssetQuantitiesAtom,
  scannedAssetSourcesAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import {
  readScanDraft,
  readScanDraftChoices,
  readScanDraftContext,
  saveScanDraft,
  scanDraftKey,
} from "~/utils/scan-draft";
import {
  allPartsSaved,
  useClearScanDraftOnSave,
  useScanDraftOnEntry,
} from "./use-scan-draft";

// why: the draft reads router state to tell a save that was accepted (which
// navigates away) from one that stayed on the page. These tests drive that
// state directly rather than mounting a router.
const mockNavigation = vi.fn();
const mockLocation = vi.fn();

vi.mock("react-router", () => ({
  useNavigation: () => mockNavigation(),
  useLocation: () => mockLocation(),
}));

// why: the draft is keyed by the signed-in user, which comes from the layout
// route's loader data and is not available without mounting the router.
const mockUser = vi.fn();
vi.mock("~/hooks/use-user-data", () => ({ useUserData: () => mockUser() }));

const USER_ID = "user-1";

/**
 * The scanners, as their routes key them. `savedTo` is where an accepted save
 * navigates; the bulk actions stay on the page and clear the list instead.
 */
const SCANNERS = [
  {
    scope: "kit",
    targetId: "kit-1",
    path: "/kits/kit-1/scan-assets",
    savedTo: "/kits/kit-1",
    other: { scope: "location", targetId: "kit-1" },
  },
  {
    scope: "location",
    targetId: "location-1",
    path: "/locations/location-1/scan-assets-kits",
    savedTo: "/locations/location-1",
    other: { scope: "kit", targetId: "location-1" },
  },
  {
    scope: "bulk",
    targetId: "scanner",
    path: "/scanner",
    savedTo: null,
    other: { scope: "assign", targetId: "scanner" },
  },
] as const;

function scanned(): ScanListItem {
  return {
    data: { id: "asset-1", title: "Camera" },
    type: "asset",
    codeType: "qr",
  } as unknown as ScanListItem;
}

/**
 * Mounted under `StrictMode` deliberately: its development double-mount runs
 * every effect twice, so a restore that only survives a single run fails here.
 */
function render(
  store: ReturnType<typeof createStore>,
  args: { scope: string; targetId: string }
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  );

  return renderHook(() => useScanDraftOnEntry(args), { wrapper });
}

describe.each(SCANNERS)(
  "$scope scanner draft",
  ({ scope, targetId, path, savedTo, other }) => {
    const draftKey = scanDraftKey(scope, USER_ID, targetId);

    beforeEach(() => {
      localStorage.clear();
      vi.clearAllMocks();
      mockNavigation.mockReturnValue({ state: "idle" });
      mockLocation.mockReturnValue({ pathname: path });
      mockUser.mockReturnValue({ id: USER_ID });
    });

    it("puts the parked list back after a reload or an error page", () => {
      saveScanDraft(draftKey, { "qr-1": scanned(), "qr-2": scanned() });
      const store = createStore();

      render(store, { scope, targetId });

      expect(Object.keys(store.get(scannedItemsAtom))).toEqual([
        "qr-1",
        "qr-2",
      ]);
      expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual([
        "qr-1",
        "qr-2",
      ]);
    });

    it("drops the draft once the save is accepted", () => {
      saveScanDraft(draftKey, { "qr-1": scanned() });
      const store = createStore();
      const { rerender } = render(store, { scope, targetId });

      if (savedTo) {
        // The action redirects to the page that shows the result.
        mockNavigation.mockReturnValue({
          state: "loading",
          formMethod: "POST",
          location: { pathname: savedTo },
        });
      } else {
        // The bulk actions save in place and then empty the list.
        store.set(scannedItemsAtom, {});
      }
      rerender();

      expect(readScanDraft(draftKey)).toBeNull();
    });

    /**
     * A save that gets no answer leaves the page where it is: submitting, then
     * idle, with no location change and the list untouched.
     */
    it("keeps the draft when the save gets no answer", () => {
      saveScanDraft(draftKey, { "qr-1": scanned() });
      const store = createStore();
      const { rerender } = render(store, { scope, targetId });

      mockNavigation.mockReturnValue({
        state: "submitting",
        formMethod: "POST",
        location: { pathname: path },
      });
      rerender();
      mockNavigation.mockReturnValue({ state: "idle" });
      rerender();

      expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-1"]);
      expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
    });

    /**
     * When the session has ended, the auth middleware sends the save to the
     * sign-in page before the action runs. Nothing was saved, so the draft is
     * the only copy of the list, and signing back in returns to the scanner.
     */
    it("keeps the draft when the save is sent to the sign-in page", () => {
      saveScanDraft(draftKey, { "qr-1": scanned() });
      const store = createStore();
      const { rerender } = render(store, { scope, targetId });

      mockNavigation.mockReturnValue({
        state: "loading",
        formMethod: "POST",
        location: {
          pathname: "/login",
          search: `?redirectTo=${path}&logged_out=1`,
        },
      });
      rerender();

      expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-1"]);
    });

    /**
     * A restored list must come back as the operator left it: rows that fell
     * back to one unit and the pre-selected location would look right and
     * move the wrong units on confirm.
     */
    it("puts back the units and source locations set on the rows", () => {
      saveScanDraft(
        draftKey,
        { "qr-1": scanned() },
        {
          choices: {
            quantities: { "asset-1": 4 },
            sources: { "asset-1": "loc-2" },
          },
        }
      );
      const store = createStore();

      render(store, { scope, targetId });

      expect(store.get(scannedAssetQuantitiesAtom)).toEqual({ "asset-1": 4 });
      expect(store.get(scannedAssetSourcesAtom)).toEqual({
        "asset-1": "loc-2",
      });
    });

    it("keeps a quantity or source changed after the scan", () => {
      const store = createStore();
      const { rerender } = render(store, { scope, targetId });
      act(() => store.set(scannedItemsAtom, { "qr-1": scanned() }));

      act(() => store.set(scannedAssetQuantitiesAtom, { "asset-1": 2 }));
      act(() => store.set(scannedAssetSourcesAtom, { "asset-1": "unplaced" }));
      rerender();

      expect(readScanDraftChoices(draftKey)).toEqual({
        quantities: { "asset-1": 2 },
        sources: { "asset-1": "unplaced" },
      });
    });

    it("does not pick up another scanner's list", () => {
      saveScanDraft(scanDraftKey(other.scope, USER_ID, other.targetId), {
        "qr-1": scanned(),
      });
      const store = createStore();

      render(store, { scope, targetId });

      expect(store.get(scannedItemsAtom)).toEqual({});
    });
  }
);

/**
 * The bulk scanner's actions (assign custody, release custody, update
 * location) share one list: switching action keeps it. So they share one draft
 * too. A draft per action would bring back, under one action, a list already
 * saved under another.
 *
 * The page opens on "View asset", which shows no list, so the action a list
 * was parked under is remembered with the draft and handed back on restore.
 */
describe("bulk scanner: one list across its actions", () => {
  const draftKey = scanDraftKey("bulk", USER_ID, "scanner");

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockNavigation.mockReturnValue({ state: "idle" });
    mockLocation.mockReturnValue({ pathname: "/scanner" });
    mockUser.mockReturnValue({ id: USER_ID });
  });

  /** Mounts the bulk scanner's draft with the action it is currently on. */
  function renderBulk(
    store: ReturnType<typeof createStore>,
    action: string | null,
    onRestore?: (context: string | null) => void
  ) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Provider store={store}>{children}</Provider>
      </StrictMode>
    );

    return renderHook(
      ({ context }: { context: string | null }) =>
        useScanDraftOnEntry({
          scope: "bulk",
          targetId: "scanner",
          context,
          onRestore,
        }),
      { wrapper, initialProps: { context: action } }
    );
  }

  it("keeps the list and its draft when the action changes", () => {
    const store = createStore();
    const { rerender } = renderBulk(store, "Assign custody");
    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender({ context: "Assign custody" });

    rerender({ context: "Release custody" });

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
    expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-1"]);
  });

  it("does not bring a saved list back under another action", () => {
    // Scanned under one action, then saved: the save empties the list.
    const first = createStore();
    const { rerender, unmount } = renderBulk(first, "Assign custody");
    first.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender({ context: "Assign custody" });
    first.set(scannedItemsAtom, {});
    rerender({ context: "Assign custody" });
    unmount();

    // Back on the scanner later, under a different action.
    const later = createStore();
    const onRestore = vi.fn();
    renderBulk(later, "Release custody", onRestore);

    expect(later.get(scannedItemsAtom)).toEqual({});
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("hands back the action a restored list was parked under", () => {
    saveScanDraft(
      draftKey,
      { "qr-1": scanned() },
      { context: "Assign custody" }
    );
    const store = createStore();
    const onRestore = vi.fn();

    // The page always opens on the action that shows no list.
    renderBulk(store, null, onRestore);

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("Assign custody");
  });

  it("remembers the action being worked in, and the latest one after a switch", () => {
    const store = createStore();
    const { rerender } = renderBulk(store, "Assign custody");
    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender({ context: "Assign custody" });
    expect(readScanDraftContext(draftKey)).toBe("Assign custody");

    rerender({ context: "Update location" });

    expect(readScanDraftContext(draftKey)).toBe("Update location");
  });

  /** Going back to "View asset" must not forget where the list belongs. */
  it("keeps the remembered action while the page is on one with no list", () => {
    const store = createStore();
    const { rerender } = renderBulk(store, "Assign custody");
    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender({ context: "Assign custody" });

    rerender({ context: null });

    expect(readScanDraftContext(draftKey)).toBe("Assign custody");
  });

  /**
   * A draft holds nothing until the first scanned code resolves, and is
   * emptied again by every save. The remembered action must outlive both, or
   * the next list scanned under the same action would be restored out of
   * sight.
   */
  it("still remembers the action after the list was emptied and refilled", () => {
    const store = createStore();
    const { rerender } = renderBulk(store, "Assign custody");
    // The first scan, not resolved yet: nothing worth drafting.
    store.set(scannedItemsAtom, { "qr-1": { codeType: "qr" } });
    rerender({ context: "Assign custody" });
    // A save empties the list.
    store.set(scannedItemsAtom, {});
    rerender({ context: "Assign custody" });

    store.set(scannedItemsAtom, { "qr-2": scanned() });
    rerender({ context: "Assign custody" });

    expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-2"]);
    expect(readScanDraftContext(draftKey)).toBe("Assign custody");
  });

  /**
   * The scanner page keys its draft by workspace as well: a code scanned in
   * one workspace means nothing, or something else, in another.
   */
  it("does not bring one workspace's list back in another", () => {
    saveScanDraft(
      scanDraftKey("bulk", USER_ID, "scanner:org-a"),
      { "qr-1": scanned() },
      { context: "Assign custody" }
    );
    const store = createStore();
    const onRestore = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Provider store={store}>{children}</Provider>
      </StrictMode>
    );

    renderHook(
      () =>
        useScanDraftOnEntry({
          scope: "bulk",
          targetId: "scanner:org-b",
          onRestore,
        }),
      { wrapper }
    );

    expect(store.get(scannedItemsAtom)).toEqual({});
    expect(onRestore).not.toHaveBeenCalled();
    // The other workspace's list is still parked for when it is back there.
    expect(
      Object.keys(
        readScanDraft(scanDraftKey("bulk", USER_ID, "scanner:org-a")) ?? {}
      )
    ).toEqual(["qr-1"]);
  });

  /**
   * The bulk actions save in place: the result shows in a dialog and the
   * list is only emptied when it is closed. A reload in between must not
   * bring back scans that already saved.
   */
  describe("a save that succeeds in place", () => {
    /** The scanner page and its drawer's save, mounted together. */
    function renderWithSave(store: ReturnType<typeof createStore>) {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <Provider store={store}>{children}</Provider>
        </StrictMode>
      );
      return renderHook(
        ({ saved }: { saved: boolean }) => {
          useScanDraftOnEntry({
            scope: "bulk",
            targetId: "scanner",
            context: "Assign custody",
          });
          useClearScanDraftOnSave(saved);
        },
        { wrapper, initialProps: { saved: false } }
      );
    }

    it("drops the draft as soon as the save succeeds, with the list still on screen", () => {
      const store = createStore();
      const { rerender } = renderWithSave(store);
      act(() => store.set(scannedItemsAtom, { "qr-1": scanned() }));
      expect(readScanDraft(draftKey)).not.toBeNull();

      rerender({ saved: true });

      expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
      expect(readScanDraft(draftKey)).toBeNull();
      expect(readScanDraftContext(draftKey)).toBeNull();
    });

    it("does not write the saved list back while it is still on screen", () => {
      const store = createStore();
      const { rerender } = renderWithSave(store);
      act(() => store.set(scannedItemsAtom, { "qr-1": scanned() }));
      rerender({ saved: true });

      // A row that resolves late changes the list under the result dialog.
      act(() =>
        store.set(scannedItemsAtom, { "qr-1": scanned(), "qr-2": scanned() })
      );

      expect(readScanDraft(draftKey)).toBeNull();
    });

    it("keeps the next list once the saved one is cleared", () => {
      const store = createStore();
      const { rerender } = renderWithSave(store);
      act(() => store.set(scannedItemsAtom, { "qr-1": scanned() }));
      rerender({ saved: true });
      // Closing the result dialog empties the list and resets the result.
      act(() => store.set(scannedItemsAtom, {}));
      rerender({ saved: false });

      act(() => store.set(scannedItemsAtom, { "qr-2": scanned() }));

      expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-2"]);
      expect(readScanDraftContext(draftKey)).toBe("Assign custody");
    });

    it("keeps the draft while the save has not succeeded", () => {
      const store = createStore();
      renderWithSave(store);
      act(() => store.set(scannedItemsAtom, { "qr-1": scanned() }));

      expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-1"]);
    });
  });
});

/** A save sent in parts counts as saved only when every part is. */
describe("allPartsSaved", () => {
  it.each([
    [["success", "success"], true],
    [["success", "skipped"], true],
    [["skipped", "success"], true],
    [["success"], true],
    [["skipped", "skipped"], false],
    [["success", "error"], false],
    [["processing", "success"], false],
    [["processing", "processing"], false],
  ] as const)("%j -> %s", (statuses, expected) => {
    expect(allPartsSaved(statuses)).toBe(expected);
  });
});
