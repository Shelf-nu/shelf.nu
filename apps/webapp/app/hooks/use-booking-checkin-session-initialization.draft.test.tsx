/**
 * Behaviour tests for the scan draft of the booking Check Out and Check In
 * scanners, which share one session hook.
 *
 * Each scanner keeps its own draft: the list has to outlive the page (a
 * reload, an error page), must stay when a save gets no answer, must go once a
 * save is accepted, and must never surface in the other scanner on the same
 * booking. None of that is visible from the drawer.
 *
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 * @see {@link file://./use-scan-draft.ts}
 */
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { BookingStatus } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanListItem } from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { readScanDraft, saveScanDraft, scanDraftKey } from "~/utils/scan-draft";
import { useBookingCheckinSessionInitialization } from "./use-booking-checkin-session-initialization";

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

/** The two scanners that share the hook, with the scanner each must not read. */
const SCANNERS = [
  { scope: "checkout", other: "checkin", path: "checkout-assets" },
  { scope: "checkin", other: "checkout", path: "checkin-assets" },
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
 * the hook's cleanup between the two mounts, so a draft damaged on the first
 * mount is gone for good by the second.
 */
function render(
  store: ReturnType<typeof createStore>,
  draftScope: "checkin" | "checkout"
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  );

  return renderHook(
    () =>
      useBookingCheckinSessionInitialization({
        session: {
          bookingId: BOOKING_ID,
          bookingName: "ZZ Test Booking",
          status: BookingStatus.ONGOING,
          expectedCount: 1,
        },
        expectedAssets: [],
        draftScope,
      }),
    { wrapper }
  );
}

describe.each(SCANNERS)("$scope scanner draft", ({ scope, other, path }) => {
  const draftKey = scanDraftKey(scope, USER_ID, BOOKING_ID);
  const scannerPath = `/bookings/${BOOKING_ID}/overview/${path}`;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockNavigation.mockReturnValue({ state: "idle" });
    mockLocation.mockReturnValue({ pathname: scannerPath });
    mockUser.mockReturnValue({ id: USER_ID });
  });

  it("puts the parked list back after a reload or an error page", () => {
    saveScanDraft(draftKey, { "qr-1": scanned(), "qr-2": scanned() });
    const store = createStore();
    store.set(scannedItemsAtom, { "stale-qr": scanned() });

    render(store, scope);

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1", "qr-2"]);
    expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual([
      "qr-1",
      "qr-2",
    ]);
  });

  it("drops the draft once the save is accepted and the booking opens", () => {
    saveScanDraft(draftKey, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store, scope);

    mockNavigation.mockReturnValue({
      state: "loading",
      formMethod: "POST",
      location: { pathname: `/bookings/${BOOKING_ID}` },
    });
    rerender();

    expect(readScanDraft(draftKey)).toBeNull();
  });

  /**
   * A save that gets no answer is returned as action data and the page stays
   * where it is: submitting, then idle, with no location change.
   */
  it("keeps the draft when the save gets no answer", () => {
    saveScanDraft(draftKey, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store, scope);

    mockNavigation.mockReturnValue({
      state: "submitting",
      formMethod: "POST",
      location: { pathname: scannerPath },
    });
    rerender();
    mockNavigation.mockReturnValue({ state: "idle" });
    rerender();

    expect(Object.keys(readScanDraft(draftKey) ?? {})).toEqual(["qr-1"]);
    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });

  it("does not pick up the other scanner's list for the same booking", () => {
    saveScanDraft(scanDraftKey(other, USER_ID, BOOKING_ID), {
      "qr-1": scanned(),
    });
    const store = createStore();

    render(store, scope);

    expect(store.get(scannedItemsAtom)).toEqual({});
  });
});
