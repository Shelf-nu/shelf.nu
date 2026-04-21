/**
 * Unit tests for {@link useBookingCheckinSessionInitialization}.
 *
 * Contract-level coverage for:
 *  - Seeding the session + expected-assets atoms on mount.
 *  - Clearing both atoms on unmount.
 *  - Re-syncing the expected-asset atom when the loader returns a new
 *    signature (e.g. a qty-tracked asset's `remaining` changed).
 *
 * Uses a scoped jotai `Provider` with an isolated `createStore()` per
 * test so atom state doesn't bleed across cases.
 *
 * @see {@link file://./use-booking-checkin-session-initialization.ts}
 */

import type { ReactNode } from "react";
import { BookingStatus } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import {
  type BookingCheckinSessionInfo,
  type BookingExpectedAsset,
  bookingCheckinSessionAtom,
  bookingExpectedAssetsAtom,
} from "~/atoms/qr-scanner";

import { useBookingCheckinSessionInitialization } from "./use-booking-checkin-session-initialization";

/**
 * Build a non-null session fixture. Overrides let individual tests
 * customize `bookingId` / `status` / `expectedCount` without repeating
 * the full shape.
 */
function makeSession(
  overrides: Partial<Exclude<BookingCheckinSessionInfo, null>> = {}
): Exclude<BookingCheckinSessionInfo, null> {
  return {
    bookingId: "booking-1",
    bookingName: "Studio Session",
    status: BookingStatus.ONGOING,
    expectedCount: 2,
    ...overrides,
  };
}

function individual(
  overrides: Partial<Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }>> = {}
): Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }> {
  return {
    kind: "INDIVIDUAL",
    id: "asset-ind-1",
    title: "Camera",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    alreadyCheckedIn: false,
    ...overrides,
  };
}

function qty(
  overrides: Partial<
    Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }>
  > = {}
): Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }> {
  return {
    kind: "QUANTITY_TRACKED",
    id: "asset-qty-1",
    title: "Battery",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    booked: 20,
    logged: 0,
    remaining: 20,
    consumptionType: "TWO_WAY",
    ...overrides,
  };
}

describe("useBookingCheckinSessionInitialization", () => {
  it("seeds the session and expected-assets atoms on mount", () => {
    const store = createStore();
    const session = makeSession({ bookingId: "booking-mount" });
    const expectedAssets = [
      individual({ id: "asset-a" }),
      qty({ id: "asset-b" }),
    ];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    renderHook(
      () => useBookingCheckinSessionInitialization({ session, expectedAssets }),
      { wrapper }
    );

    expect(store.get(bookingCheckinSessionAtom)).toEqual(session);
    expect(store.get(bookingExpectedAssetsAtom)).toEqual(expectedAssets);
  });

  it("clears both atoms on unmount", () => {
    const store = createStore();
    const session = makeSession({ bookingId: "booking-unmount" });
    const expectedAssets = [individual()];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { unmount } = renderHook(
      () => useBookingCheckinSessionInitialization({ session, expectedAssets }),
      { wrapper }
    );

    // sanity: atoms were populated
    expect(store.get(bookingCheckinSessionAtom)).not.toBeNull();
    expect(store.get(bookingExpectedAssetsAtom)).toHaveLength(1);

    unmount();

    expect(store.get(bookingCheckinSessionAtom)).toBeNull();
    expect(store.get(bookingExpectedAssetsAtom)).toEqual([]);
  });

  it("re-syncs expected-assets when a qty-tracked 'remaining' changes on rerender", () => {
    const store = createStore();
    const session = makeSession({ bookingId: "booking-resync" });
    const initial = [qty({ id: "asset-resync", remaining: 20, logged: 0 })];
    const updated = [qty({ id: "asset-resync", remaining: 12, logged: 8 })];

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { rerender } = renderHook(
      ({ expectedAssets }: { expectedAssets: BookingExpectedAsset[] }) =>
        useBookingCheckinSessionInitialization({ session, expectedAssets }),
      { wrapper, initialProps: { expectedAssets: initial } }
    );

    // Initial seed.
    expect(store.get(bookingExpectedAssetsAtom)).toEqual(initial);

    rerender({ expectedAssets: updated });

    const synced = store.get(bookingExpectedAssetsAtom);
    expect(synced).toHaveLength(1);
    const first = synced[0];
    expect(first.kind).toBe("QUANTITY_TRACKED");
    if (first.kind === "QUANTITY_TRACKED") {
      expect(first.remaining).toBe(12);
      expect(first.logged).toBe(8);
    }
  });
});
