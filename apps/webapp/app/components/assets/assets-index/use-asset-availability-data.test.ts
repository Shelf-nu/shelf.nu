/**
 * Availability-calendar data hook tests
 *
 * Regression coverage for the assets-index availability view. The view is fed
 * by two different loaders with two different booking shapes:
 *   - Simple mode (`data.server.ts`) includes the `BookingAsset` pivot
 *     relation → `asset.bookingAssets: { booking }[]`.
 *   - Advanced mode (`query.server.ts` raw SQL) aggregates the pivot into a
 *     flat `asset.bookings: AdvancedAssetBooking[]`.
 *
 * The quantities pivot updated the hook + simple loader to the `bookingAssets`
 * shape but left advanced mode on `bookings`, so advanced-mode availability
 * rendered the asset rows but produced zero booking events. These tests lock in
 * that BOTH shapes yield events.
 *
 * @see {@link file://./use-asset-availability-data.ts}
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedAssetBooking } from "~/modules/asset/types";
import { useAssetAvailabilityData } from "./use-asset-availability-data";

// why: useUserRoleHelper resolves roles via Remix loader data; tests do not
// run inside a route, so stub it to a single-role admin set.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: ["ADMIN"] }),
}));

// why: useCurrentOrganization reads Remix root loader data unavailable in the
// test; a plain object is enough — the permission helper is stubbed below.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({ id: "org-1" }),
}));

// why: useHints reads client hints from a Remix context; pin the timezone so
// date conversion is deterministic.
vi.mock("~/utils/client-hints", () => ({
  useHints: () => ({ timeZone: "UTC" }),
}));

// why: custody-view gating is orthogonal to this hook's shape-normalization;
// force it off so event titles stay the plain booking name.
vi.mock(
  "~/utils/permissions/custody-and-bookings-permissions.validator.client",
  () => ({
    userHasCustodyViewPermission: () => false,
  })
);

/** Builds a minimal AdvancedAssetBooking with sane defaults. Advanced-mode
 * elements carry the per-slice `assetKitId`/`kitName`/`quantity` inline, so
 * overriding those on the booking mirrors one flattened advanced-mode row. */
function makeBooking(
  overrides: Partial<AdvancedAssetBooking> = {}
): AdvancedAssetBooking {
  return {
    id: "booking-1",
    name: "Test Booking",
    status: "RESERVED",
    description: null,
    from: "2026-07-10T09:00:00.000Z",
    to: "2026-07-11T09:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

/** Builds one simple-mode `bookingAssets[]` element: a BookingAsset pivot row
 * with its nested booking plus the slice-level fields the fold reads. */
function makeSlice(
  booking: AdvancedAssetBooking,
  slice: {
    assetKitId?: string | null;
    kitName?: string | null;
    quantity?: number;
  } = {}
): {
  booking: AdvancedAssetBooking;
  assetKitId: string | null;
  kitName: string | null;
  quantity: number;
} {
  return {
    booking,
    assetKitId: slice.assetKitId ?? null,
    kitName: slice.kitName ?? null,
    quantity: slice.quantity ?? 1,
  };
}

/** Casts loosely-typed test items to the hook's expected input type. */
type Items = Parameters<typeof useAssetAvailabilityData>[0];

describe("useAssetAvailabilityData", () => {
  it("produces events for advanced-mode assets (flat `bookings` shape)", () => {
    const booking = makeBooking({
      id: "booking-adv",
      name: "Advanced Booking",
    });
    const items = [
      { id: "asset-adv", title: "Advanced Asset", bookings: [booking] },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      title: "Advanced Booking",
      resourceId: "asset-adv",
    });
    expect(result.current.events[0].extendedProps).toMatchObject({
      id: "booking-adv",
      url: "/bookings/booking-adv",
    });
  });

  it("produces events for simple-mode assets (`bookingAssets` pivot shape)", () => {
    const booking = makeBooking({ id: "booking-sim", name: "Simple Booking" });
    const items = [
      {
        id: "asset-sim",
        title: "Simple Asset",
        bookingAssets: [{ booking }],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      title: "Simple Booking",
      resourceId: "asset-sim",
    });
  });

  it("emits no events for assets carrying neither booking shape", () => {
    const items = [
      { id: "asset-none", title: "No Bookings Asset" },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(0);
    // The asset row (resource) still renders even without bookings.
    expect(result.current.resources).toHaveLength(1);
  });

  it("(a) folds a standalone + kit slice on ONE booking into one event", () => {
    // Advanced shape: two pivot rows for the same booking id.
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          makeBooking({ id: "b1", assetKitId: null, quantity: 2 }),
          makeBooking({
            id: "b1",
            assetKitId: "ak1",
            kitName: "Camera Kit",
            quantity: 3,
          }),
        ],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    const props = result.current.events[0].extendedProps;
    expect(props.sliceCount).toBe(2);
    expect(props.bookedTotal).toBe(5);
    expect(props.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetKitId: null, quantity: 2 }),
        expect.objectContaining({
          assetKitId: "ak1",
          kitName: "Camera Kit",
          quantity: 3,
        }),
      ])
    );
  });

  it("(b) folds 3 slices (standalone + 2 kits) into one event", () => {
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          makeBooking({ id: "b1", assetKitId: null, quantity: 1 }),
          makeBooking({
            id: "b1",
            assetKitId: "ak1",
            kitName: "Kit A",
            quantity: 2,
          }),
          makeBooking({
            id: "b1",
            assetKitId: "ak2",
            kitName: "Kit B",
            quantity: 4,
          }),
        ],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    const props = result.current.events[0].extendedProps;
    expect(props.sliceCount).toBe(3);
    expect(props.bookedTotal).toBe(7);
  });

  it("(c) keeps kit attribution for a single kit-only slice", () => {
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          makeBooking({
            id: "b1",
            assetKitId: "ak1",
            kitName: "Camera Kit",
            quantity: 1,
          }),
        ],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    const props = result.current.events[0].extendedProps;
    expect(props.sliceCount).toBe(1);
    expect(props.slices[0].assetKitId).toBe("ak1");
    expect(props.slices[0].kitName).toBe("Camera Kit");
  });

  it("(d) leaves a plain single standalone booking unchanged", () => {
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        bookings: [makeBooking({ id: "b1" })],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    const props = result.current.events[0].extendedProps;
    expect(props.sliceCount).toBe(1);
    expect(props.slices[0].assetKitId).toBeNull();
    expect(props.bookedTotal).toBe(1);
  });

  it("(e) merges the simple-mode shape identically to advanced mode", () => {
    // Simple-mode mirror of case (a): two BookingAsset pivot rows, same booking.
    const b1 = makeBooking({ id: "b1" });
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        bookingAssets: [
          makeSlice(b1, { assetKitId: null, quantity: 2 }),
          makeSlice(b1, {
            assetKitId: "ak1",
            kitName: "Camera Kit",
            quantity: 3,
          }),
        ],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    expect(result.current.events).toHaveLength(1);
    const props = result.current.events[0].extendedProps;
    expect(props.sliceCount).toBe(2);
    expect(props.bookedTotal).toBe(5);
    // Assert content parity with advanced-mode case (a): the simple-mode pivot
    // must carry per-slice kit attribution through the collapse, not just counts.
    expect(props.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetKitId: null, quantity: 2 }),
        expect.objectContaining({
          assetKitId: "ak1",
          kitName: "Camera Kit",
          quantity: 3,
        }),
      ])
    );
  });

  it("(g) uses BookingAsset.quantity (booked units), never Asset.quantity (stock)", () => {
    // Quantity-semantics guard (.claude/rules/quantity-semantics-per-surface.md):
    // the asset carries a workspace stock of 100 units, but the booking only
    // reserved 5. The fold must multiply by BOOKED units, never asset stock.
    const items = [
      {
        id: "asset-1",
        title: "Camera",
        quantity: 100,
        bookings: [makeBooking({ id: "b1", assetKitId: null, quantity: 5 })],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    const props = result.current.events[0].extendedProps;
    expect(props.bookedTotal).toBe(5);
    expect(props.slices[0].quantity).toBe(5);
  });

  it("(f) does not over-merge across bookings or across assets", () => {
    // Two DIFFERENT bookings on one asset → two events (no fold across bookings).
    const twoBookings = [
      {
        id: "asset-1",
        title: "Camera",
        bookings: [makeBooking({ id: "b1" }), makeBooking({ id: "b2" })],
      },
    ] as unknown as Items;
    const { result: r1 } = renderHook(() =>
      useAssetAvailabilityData(twoBookings)
    );
    expect(r1.current.events).toHaveLength(2);

    // Two DIFFERENT assets sharing booking id "b1" → two events, distinct
    // resourceIds (grouping is keyed per-asset, not globally).
    const twoAssets = [
      { id: "asset-1", title: "Camera", bookings: [makeBooking({ id: "b1" })] },
      { id: "asset-2", title: "Lens", bookings: [makeBooking({ id: "b1" })] },
    ] as unknown as Items;
    const { result: r2 } = renderHook(() =>
      useAssetAvailabilityData(twoAssets)
    );
    expect(r2.current.events).toHaveLength(2);
    expect(new Set(r2.current.events.map((e) => e.resourceId)).size).toBe(2);
  });

  it("(h) flags quantityTracked from the asset type so the bar can hide Qty for INDIVIDUAL", () => {
    const items = [
      {
        id: "asset-qt",
        title: "Cables",
        type: "QUANTITY_TRACKED",
        bookings: [makeBooking({ id: "b1", quantity: 3 })],
      },
      {
        id: "asset-ind",
        title: "Camera",
        type: "INDIVIDUAL",
        bookings: [
          makeBooking({ id: "b1", assetKitId: "ak1", kitName: "Kit" }),
        ],
      },
    ] as unknown as Items;

    const { result } = renderHook(() => useAssetAvailabilityData(items));

    const byResource = new Map(
      result.current.events.map((e) => [e.resourceId, e.extendedProps])
    );
    expect(byResource.get("asset-qt")?.quantityTracked).toBe(true);
    // INDIVIDUAL asset booked via a kit → quantityTracked false, so the
    // renderer suppresses the redundant "Qty 1".
    expect(byResource.get("asset-ind")?.quantityTracked).toBe(false);
  });
});
