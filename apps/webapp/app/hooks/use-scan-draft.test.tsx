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
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanListItem } from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import {
  readScanDraft,
  readScanDraftContext,
  saveScanDraft,
  saveScanDraftContext,
  scanDraftKey,
} from "~/utils/scan-draft";
import { useScanDraftOnEntry } from "./use-scan-draft";

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
    saveScanDraft(draftKey, { "qr-1": scanned() });
    saveScanDraftContext(draftKey, "Assign custody");
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
   * An emptied list takes its remembered action with it. The next scan under
   * the same action has to remember it again, or a reload would restore the
   * list out of sight.
   */
  it("remembers the action again once a new list starts", () => {
    const store = createStore();
    const { rerender } = renderBulk(store, "Assign custody");
    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender({ context: "Assign custody" });
    store.set(scannedItemsAtom, {});
    rerender({ context: "Assign custody" });
    expect(readScanDraftContext(draftKey)).toBeNull();

    store.set(scannedItemsAtom, { "qr-2": scanned() });
    rerender({ context: "Assign custody" });

    expect(readScanDraftContext(draftKey)).toBe("Assign custody");
  });
});
