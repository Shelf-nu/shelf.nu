/**
 * Behaviour tests for the Check Out session hook's scan draft.
 *
 * Three rules pull against each other and all three are invisible on screen:
 * the scan list has to survive leaving the page, must not be restored once its
 * scans have gone out, and must not be clobbered by the atom clear that runs on
 * the way in. Each is covered here because none of them can be seen from the
 * drawer, which renders an empty list either way.
 *
 * @see {@link file://./use-booking-fulfil-session-initialization.ts}
 * @see {@link file://./../utils/scan-draft.ts}
 */
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FulfilSessionInfo, ScanListItem } from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { readScanDraft, saveScanDraft, scanDraftKey } from "~/utils/scan-draft";
import { useBookingFulfilSessionInitialization } from "./use-booking-fulfil-session-initialization";

// why: the hook reads router state to tell a submission that was accepted
// (which navigates away) from one that was refused (which re-renders in
// place). These tests drive that state directly rather than mounting a router.
const mockNavigation = vi.fn();
const mockLocation = vi.fn();

vi.mock("react-router", () => ({
  useNavigation: () => mockNavigation(),
  useLocation: () => mockLocation(),
}));

const BOOKING_ID = "booking-1";
const DRAFT_KEY = scanDraftKey("fulfil", BOOKING_ID);
const SCANNER_PATH = `/bookings/${BOOKING_ID}/overview/fulfil-and-checkout`;

function session(): NonNullable<FulfilSessionInfo> {
  return {
    bookingId: BOOKING_ID,
    bookingName: "Shoot day 1",
    bookingFrom: "2026-01-01T09:00:00.000Z",
    bookingStatus: "RESERVED",
    checksOutScannedOnly: false,
    expectedModelRequests: [],
    alreadyIncluded: [],
  } as unknown as NonNullable<FulfilSessionInfo>;
}

function scanned(): ScanListItem {
  return {
    data: { id: "asset-1", title: "Camera" },
    type: "asset",
    codeType: "qr",
  } as unknown as ScanListItem;
}

/**
 * Mounted under `StrictMode` deliberately. Its development double-mount runs
 * the hook's cleanup between the two mounts, which clears the scan atom and
 * the booking ref — so a draft damaged on the first mount is gone for good by
 * the second. Mounting plainly hides that entirely.
 */
function render(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <Provider store={store}>{children}</Provider>
    </StrictMode>
  );

  return renderHook(
    () => useBookingFulfilSessionInitialization({ session: session() }),
    { wrapper }
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockNavigation.mockReturnValue({ state: "idle" });
  mockLocation.mockReturnValue({ pathname: SCANNER_PATH });
});

describe("restoring a parked scan list", () => {
  it("puts a saved draft back on the scan list", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();

    render(store);

    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });

  /**
   * Seeding the session clears `scannedItemsAtom` as a side effect, so the
   * mirror runs once against the pre-clear list. Saving that would overwrite
   * the draft with whatever the last flow left behind, destroying the thing
   * being restored.
   */
  it("does not let the entry clear overwrite the draft", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    store.set(scannedItemsAtom, { "stale-qr": scanned() });

    render(store);

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });

  it("starts empty when nothing was parked", () => {
    const store = createStore();

    render(store);

    expect(store.get(scannedItemsAtom)).toEqual({});
  });
});

describe("mirroring the scan list", () => {
  it("saves a scan so it survives leaving the page", () => {
    const store = createStore();
    const { rerender } = render(store);

    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender();

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
  });

  it("follows a removal, so a row taken off the list stays off", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned(), "qr-2": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    store.set(scannedItemsAtom, { "qr-1": scanned() });
    rerender();

    expect(Object.keys(readScanDraft(DRAFT_KEY) ?? {})).toEqual(["qr-1"]);
  });
});

describe("clearing once the scans have gone out", () => {
  it("drops the draft when a submission navigates away", () => {
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
   * The case the draft exists for. A refused action re-renders in place with
   * no location change, and throwing the list away there is exactly the
   * failure being fixed.
   */
  it("keeps the draft when a submission is refused", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    mockNavigation.mockReturnValue({
      state: "loading",
      formMethod: "POST",
      location: { pathname: SCANNER_PATH },
    });
    rerender();

    expect(readScanDraft(DRAFT_KEY)).not.toBeNull();
  });

  /** Cancel is a plain navigation, and parks the list rather than binning it. */
  it("keeps the draft when the operator navigates away without submitting", () => {
    saveScanDraft(DRAFT_KEY, { "qr-1": scanned() });
    const store = createStore();
    const { rerender } = render(store);

    mockNavigation.mockReturnValue({
      state: "loading",
      location: { pathname: `/bookings/${BOOKING_ID}` },
    });
    rerender();

    expect(readScanDraft(DRAFT_KEY)).not.toBeNull();
  });
});
