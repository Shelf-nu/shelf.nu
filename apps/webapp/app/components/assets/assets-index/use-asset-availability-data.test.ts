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
 * Both loader shapes must yield the same events. These tests lock that in for
 * the simple `bookingAssets` shape and the advanced `bookings` shape, and
 * cover the returned-slice rule that ends a bar at the asset's check-in.
 *
 * @see {@link file://./use-asset-availability-data.ts}
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedAssetBooking } from "~/modules/asset/types";
import { toIsoDateTimeToUserTimezone } from "~/utils/date-fns";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  isSliceReturned,
  resolveReturnedAt,
  returnedBarEnd,
  useAssetAvailabilityData,
} from "./use-asset-availability-data";

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
// default it off so event titles stay the plain booking name. A `vi.fn` so
// the one title-order case below can switch it on for a single render.
vi.mock(
  "~/utils/permissions/custody-and-bookings-permissions.validator.client",
  () => ({
    userHasCustodyViewPermission: vi.fn(() => false),
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

/**
 * Returned slices: an asset checked in from a live booking is free again, so
 * its bar must stop at the check-in instead of running to the booking's end.
 * The rule reads the per-slice BookingAsset markers, never the booking status
 * alone, and guards against the stale check-in marker the check-in backfill
 * can leave on a row.
 */
describe("useAssetAvailabilityData — returned slices", () => {
  const FROM = "2026-07-10T09:00:00.000Z";
  const TO = "2026-07-13T17:00:00.000Z";
  const OUT = "2026-07-10T09:05:00.000Z";
  const BACK = "2026-07-10T15:30:00.000Z";
  // Bar start/end go through the same zone formatter as every bar today
  // (`useHints` is pinned to UTC above), so compare against its output.
  const iso = (d: string) => toIsoDateTimeToUserTimezone(d, "UTC");

  const ongoing = (overrides: Partial<AdvancedAssetBooking> = {}) =>
    makeBooking({
      id: "b1",
      name: "Event",
      status: "ONGOING",
      from: FROM,
      to: TO,
      ...overrides,
    });

  const eventFor = (items: unknown) => {
    const { result } = renderHook(() =>
      useAssetAvailabilityData(items as Items)
    );
    expect(result.current.events).toHaveLength(1);
    return result.current.events[0];
  };

  it("(i) keeps the full bar while any slice of the asset is still out", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({ assetKitId: null, checkedOutAt: OUT, checkedInAt: BACK }),
          ongoing({
            assetKitId: "ak1",
            kitName: "Kit",
            checkedOutAt: OUT,
            checkedInAt: null,
          }),
        ],
      },
    ]);

    expect(event.end).toBe(iso(TO));
    expect(event.title).toBe("Event");
    expect(event.extendedProps).toMatchObject({
      returned: false,
      returnedAt: null,
      status: "ONGOING",
    });
    expect(event.classNames).toContain("md:bg-purple-50");
    expect(event.classNames).not.toContain("booking-returned");
  });

  it("(j) ends the bar at the check-in, styled as complete, once every slice is back", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [ongoing({ checkedOutAt: OUT, checkedInAt: BACK })],
      },
    ]);

    expect(event.end).toBe(iso(BACK));
    expect(event.start).toBe(iso(FROM));
    // The bar's "Returned <time>" prefix is rendered by the event card from
    // `returnedAt`; the title stays the booking name.
    expect(event.title).toBe("Event");
    expect(event.classNames).toContain("booking-returned");
    expect(event.classNames).toContain("md:bg-success-50");
    expect(event.classNames).not.toContain("md:bg-purple-50");
    // The popover keeps the booking's real period and status.
    expect(event.extendedProps).toMatchObject({
      status: "ONGOING",
      end: TO,
      returned: true,
      returnedAt: BACK,
    });
  });

  it("(k) keeps the custodian suffix on a returned bar's title", () => {
    vi.mocked(userHasCustodyViewPermission).mockReturnValueOnce(true);
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({
            checkedOutAt: OUT,
            checkedInAt: BACK,
            custodianTeamMember: { id: "tm1", name: "Ada" },
          }),
        ],
      },
    ]);

    expect(event.title).toBe("Event | Ada");
  });

  it("(l) never reads a RESERVED booking as returned", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({ status: "RESERVED", checkedOutAt: OUT, checkedInAt: BACK }),
        ],
      },
    ]);

    expect(event.end).toBe(iso(TO));
    expect(event.extendedProps).toMatchObject({ returned: false });
    expect(event.classNames).toContain("md:bg-blue-50");
  });

  it("(m) keeps the full bar for a quantity-tracked slice that is only partly back", () => {
    const event = eventFor([
      {
        id: "asset-qt",
        title: "Cables",
        type: "QUANTITY_TRACKED",
        bookings: [
          ongoing({ quantity: 5, checkedOutAt: OUT, checkedInAt: null }),
        ],
      },
    ]);

    expect(event.end).toBe(iso(TO));
    expect(event.extendedProps).toMatchObject({ returned: false });
  });

  it("(n) treats a check-in older than the departure as not returned", () => {
    // A row stamped by the check-in backfill can carry both markers with the
    // check-in first; that is not a return.
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [ongoing({ checkedOutAt: BACK, checkedInAt: OUT })],
      },
    ]);

    expect(event.end).toBe(iso(TO));
    expect(event.extendedProps).toMatchObject({ returned: false });
  });

  it("(o) keeps the bar end after its start when the check-in precedes the booking start", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({
            from: "2026-07-10T18:00:00.000Z",
            checkedOutAt: "2026-07-10T08:00:00.000Z",
            checkedInAt: "2026-07-10T09:00:00.000Z",
          }),
        ],
      },
    ]);

    expect(new Date(event.end as string).getTime()).toBeGreaterThan(
      new Date(event.start as string).getTime()
    );
    expect(event.end).toBe(iso("2026-07-10T19:00:00.000Z"));
    expect(event.extendedProps).toMatchObject({
      returned: true,
      returnedAt: "2026-07-10T09:00:00.000Z",
    });
  });

  it("(p) keeps the green fill for a same-day return", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({
            to: "2026-07-10T17:00:00.000Z",
            checkedOutAt: OUT,
            checkedInAt: BACK,
          }),
        ],
      },
    ]);

    expect(event.classNames).toContain("md:bg-success-50");
    expect(
      event.classNames.some((c: string) => c.includes("!bg-transparent"))
    ).toBe(false);
  });

  it("(q) reads the same markers from the simple-mode pivot shape, as Dates", () => {
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookingAssets: [
          {
            booking: ongoing(),
            assetKitId: null,
            quantity: 1,
            checkedOutAt: new Date(OUT),
            checkedInAt: new Date(BACK),
          },
        ],
      },
    ]);

    expect(event.end).toBe(iso(BACK));
    expect(event.extendedProps).toMatchObject({
      returned: true,
      returnedAt: BACK,
    });
  });

  it("(r) folds the latest check-in across slices into returnedAt", () => {
    const later = "2026-07-11T08:00:00.000Z";
    const event = eventFor([
      {
        id: "asset-1",
        title: "Camera",
        bookings: [
          ongoing({ assetKitId: null, checkedOutAt: OUT, checkedInAt: BACK }),
          ongoing({
            assetKitId: "ak1",
            kitName: "Kit",
            checkedOutAt: OUT,
            checkedInAt: later,
          }),
        ],
      },
    ]);

    expect(event.end).toBe(iso(later));
    expect(event.extendedProps).toMatchObject({ returnedAt: later });
  });
});

describe("returned-slice helpers", () => {
  it("isSliceReturned needs a check-in at or after the departure", () => {
    expect(isSliceReturned({ checkedOutAt: null, checkedInAt: null })).toBe(
      false
    );
    expect(
      isSliceReturned({
        checkedOutAt: "2026-07-10T09:00:00.000Z",
        checkedInAt: null,
      })
    ).toBe(false);
    expect(
      isSliceReturned({
        checkedOutAt: null,
        checkedInAt: "2026-07-10T09:00:00.000Z",
      })
    ).toBe(true);
    expect(
      isSliceReturned({
        checkedOutAt: "2026-07-10T09:00:00.000Z",
        checkedInAt: "2026-07-10T09:00:00.000Z",
      })
    ).toBe(true);
    expect(
      isSliceReturned({
        checkedOutAt: "2026-07-10T10:00:00.000Z",
        checkedInAt: "2026-07-10T09:00:00.000Z",
      })
    ).toBe(false);
  });

  it("resolveReturnedAt only answers for live bookings with every slice back", () => {
    const back = {
      checkedOutAt: "2026-07-10T09:00:00.000Z",
      checkedInAt: "2026-07-10T12:00:00.000Z",
    };
    expect(resolveReturnedAt("ONGOING", [back])).toBe(
      "2026-07-10T12:00:00.000Z"
    );
    expect(resolveReturnedAt("OVERDUE", [back])).toBe(
      "2026-07-10T12:00:00.000Z"
    );
    expect(resolveReturnedAt("RESERVED", [back])).toBeNull();
    expect(resolveReturnedAt("ONGOING", [])).toBeNull();
    expect(
      resolveReturnedAt("ONGOING", [
        back,
        { checkedOutAt: "2026-07-10T09:00:00.000Z", checkedInAt: null },
      ])
    ).toBeNull();
  });

  it("returnedBarEnd pushes an end at or before the start to one hour after it", () => {
    expect(
      returnedBarEnd("2026-07-10T12:00:00.000Z", "2026-07-10T09:00:00.000Z")
    ).toBe("2026-07-10T12:00:00.000Z");
    expect(
      returnedBarEnd("2026-07-10T09:00:00.000Z", "2026-07-10T09:00:00.000Z")
    ).toBe("2026-07-10T10:00:00.000Z");
    expect(
      returnedBarEnd(
        "2026-07-10T08:00:00.000Z",
        new Date("2026-07-10T09:00:00.000Z")
      )
    ).toBe("2026-07-10T10:00:00.000Z");
  });
});
