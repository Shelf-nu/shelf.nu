/**
 * Behaviour tests for the Scan to Assign session hook's scan draft.
 *
 * The scanned list has to outlive the page (a reload, an error page), must
 * stay when a save gets no answer, and must go once a save is accepted. None
 * of that is visible from the drawer, which renders an empty list either way.
 *
 * The draft mechanics themselves are covered through the Check Out hook, which
 * shares them; this suite pins that the Scan to Assign hook is wired to them.
 *
 * @see {@link file://./use-booking-assign-session-initialization.ts}
 * @see {@link file://./use-scan-draft.ts}
 * @see {@link file://./use-booking-fulfil-session-initialization.test.tsx}
 */
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanListItem } from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { readScanDraft, saveScanDraft, scanDraftKey } from "~/utils/scan-draft";
import { useBookingAssignSessionInitialization } from "./use-booking-assign-session-initialization";

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

const BOOKING_ID = "booking-1";
const USER_ID = "user-1";
const DRAFT_KEY = scanDraftKey("assign", USER_ID, BOOKING_ID);
const SCANNER_PATH = `/bookings/${BOOKING_ID}/overview/scan-assets`;

function scanned(): ScanListItem {
  return {
    data: { id: "asset-1", title: "Camera" },
    type: "asset",
    codeType: "qr",
  } as unknown as ScanListItem;
}

/**
 * Mounted under `StrictMode` deliberately: its development double-mount runs
 * the hook's cleanup between the two mounts, so a draft damaged on the first
 * mount is gone for good by the second.
 */
function render(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  );

  return renderHook(
    () =>
      useBookingAssignSessionInitialization({
        session: null,
        bookingId: BOOKING_ID,
      }),
    { wrapper }
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockNavigation.mockReturnValue({ state: "idle" });
  mockLocation.mockReturnValue({ pathname: SCANNER_PATH });
  mockUser.mockReturnValue({ id: USER_ID });
});

describe("coming back to the scanner", () => {
  it("puts the parked list back after a reload or an error page", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned(), "qr-2": scanned() });
    const store = createStore();

    render(store);

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1", "qr-2"]);
  });

  it("does not let the entry clear overwrite the draft", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    store.set(scannedItemsAtom, { "stale-qr": scanned() });

    render(store);

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });

  /** Check Out and Scan to Assign open on the same booking: separate lists. */
  it("does not pick up the Check Out scanner's list for the same booking", () => {
    saveScanDraft(scanDraftKey("fulfil", USER_ID, BOOKING_ID), {
      "qr-1": scanned(),
    });
    const store = createStore();

    render(store);

    expect(store.get(scannedItemsAtom)).toEqual({});
  });
});

describe("keeping the list while scanning", () => {
  it("saves each scan as it lands", () => {
    const store = createStore();
    const { rerender } = render(store);

    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender();

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
  });

  it("forgets the list when the operator clears it", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    store.set(scannedItemsAtom, {});
    rerender();

    expect(readScanDraft(DRAFT_KEY)).toBeNull();
  });
});

describe("after Confirm", () => {
  it("drops the draft once the save is accepted and the booking opens", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    mockNavigation.mockReturnValue({
      state: "loading",
      formMethod: "POST",
      location: { pathname: `/bookings/${BOOKING_ID}` },
    });
    rerender();

    expect(readScanDraft(DRAFT_KEY)).toBeNull();
  });

  /**
   * A save that gets no answer is returned as action data and the page stays
   * where it is: the submission goes straight from submitting back to idle
   * with no location change. The list is the only copy of the work.
   */
  it("keeps the draft when the save gets no answer", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    mockNavigation.mockReturnValue({
      state: "submitting",
      formMethod: "POST",
      location: { pathname: SCANNER_PATH },
    });
    rerender();
    mockNavigation.mockReturnValue({ state: "idle" });
    rerender();

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });
});
