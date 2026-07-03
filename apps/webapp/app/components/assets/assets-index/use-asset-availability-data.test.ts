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

/** Builds a minimal AdvancedAssetBooking with sane defaults. */
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
});
