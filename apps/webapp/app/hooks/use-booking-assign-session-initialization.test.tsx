/**
 * Behaviour tests for {@link useBookingAssignSessionInitialization}.
 *
 * The hook owns two things that pull in opposite directions on a loader
 * revalidation: the operator's in-progress scan list, which must survive one,
 * and the reservation context, which must not. Both are exercised here
 * because getting either backwards is invisible on screen: a stale
 * reservation still renders a plausible progress strip, and a cleared scan
 * list still renders an empty one.
 *
 * @see {@link file://./use-booking-assign-session-initialization.ts}
 */
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import type {
  AlreadyIncludedRow,
  ExpectedModelRequest,
} from "~/atoms/qr-scanner";
import {
  assignAlreadyIncludedAtom,
  expectedModelRequestsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import type { AssignSessionInfo } from "./use-booking-assign-session-initialization";
import { useBookingAssignSessionInitialization } from "./use-booking-assign-session-initialization";

function modelRequest(
  overrides: Partial<ExpectedModelRequest> = {}
): ExpectedModelRequest {
  return {
    assetModelId: "model-1",
    assetModelName: "Model One",
    booked: 2,
    remaining: 2,
    ...overrides,
  };
}

function includedRow(
  overrides: Partial<AlreadyIncludedRow> = {}
): AlreadyIncludedRow {
  return {
    id: "asset-1",
    title: "Asset 1",
    mainImage: null,
    thumbnailImage: null,
    assetModelId: "model-1",
    claimable: true,
    kitId: null,
    bookedQuantity: 1,
    type: "INDIVIDUAL",
    ...overrides,
  } as AlreadyIncludedRow;
}

/** Mounts the hook against a store the test can read back and re-render. */
function renderSession(
  store: ReturnType<typeof createStore>,
  initial: { session: AssignSessionInfo; bookingId: string }
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  return renderHook(
    (props: { session: AssignSessionInfo; bookingId: string }) =>
      useBookingAssignSessionInitialization(props),
    { wrapper, initialProps: initial }
  );
}

describe("useBookingAssignSessionInitialization", () => {
  it("seeds the reservation atoms and clears the scan list on mount", () => {
    const store = createStore();
    store.set(scannedItemsAtom, { "stale-qr": {} as never });

    renderSession(store, {
      bookingId: "booking-1",
      session: {
        expectedModelRequests: [modelRequest()],
        alreadyIncluded: [includedRow()],
      },
    });

    expect(store.get(expectedModelRequestsAtom)).toHaveLength(1);
    expect(store.get(assignAlreadyIncludedAtom)).toHaveLength(1);
    // A prior flow's scans must never surface in this session.
    expect(store.get(scannedItemsAtom)).toEqual({});
  });

  /**
   * The regression this split exists for. A refused submit revalidates the
   * loader and stays on the page, so the operator's scans have to survive
   * while the reservation context catches up. Holding the context frozen
   * instead lets the drawer credit a scan against a unit the server has
   * already given away.
   */
  it("refreshes reservation context on a same-booking revalidation without dropping scans", () => {
    const store = createStore();
    const { rerender } = renderSession(store, {
      bookingId: "booking-1",
      session: {
        expectedModelRequests: [modelRequest({ remaining: 2 })],
        alreadyIncluded: [includedRow({ claimable: true })],
      },
    });

    store.set(scannedItemsAtom, { "qr-1": {} as never });

    // A fresh `session` object for the SAME booking: the unit was taken
    // elsewhere, and the row is no longer claimable.
    rerender({
      bookingId: "booking-1",
      session: {
        expectedModelRequests: [modelRequest({ remaining: 0 })],
        alreadyIncluded: [includedRow({ claimable: false })],
      },
    });

    expect(store.get(expectedModelRequestsAtom)[0].remaining).toBe(0);
    expect(store.get(assignAlreadyIncludedAtom)[0].claimable).toBe(false);
    // The scan the operator has not resubmitted yet is still there.
    expect(Object.keys(store.get(scannedItemsAtom))).toEqual(["qr-1"]);
  });

  it("clears the scan list when the booking changes", () => {
    const store = createStore();
    const { rerender } = renderSession(store, {
      bookingId: "booking-1",
      session: { expectedModelRequests: [modelRequest()], alreadyIncluded: [] },
    });

    store.set(scannedItemsAtom, { "qr-1": {} as never });

    rerender({
      bookingId: "booking-2",
      session: { expectedModelRequests: [], alreadyIncluded: [] },
    });

    expect(store.get(scannedItemsAtom)).toEqual({});
    expect(store.get(expectedModelRequestsAtom)).toEqual([]);
  });

  it("empties the reservation atoms when the booking reserves nothing", () => {
    const store = createStore();
    const { rerender } = renderSession(store, {
      bookingId: "booking-1",
      session: {
        expectedModelRequests: [modelRequest()],
        alreadyIncluded: [includedRow()],
      },
    });

    rerender({ bookingId: "booking-1", session: null });

    expect(store.get(expectedModelRequestsAtom)).toEqual([]);
    expect(store.get(assignAlreadyIncludedAtom)).toEqual([]);
  });

  it("reverses all three atoms on unmount", () => {
    const store = createStore();
    const { unmount } = renderSession(store, {
      bookingId: "booking-1",
      session: {
        expectedModelRequests: [modelRequest()],
        alreadyIncluded: [includedRow()],
      },
    });

    store.set(scannedItemsAtom, { "qr-1": {} as never });
    unmount();

    expect(store.get(expectedModelRequestsAtom)).toEqual([]);
    expect(store.get(assignAlreadyIncludedAtom)).toEqual([]);
    expect(store.get(scannedItemsAtom)).toEqual({});
  });
});
