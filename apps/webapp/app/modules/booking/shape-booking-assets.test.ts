import { describe, it, expect } from "vitest";
import { shapeBookingAssets } from "./shape-booking-assets";

// Minimal enriched-asset fixture (only fields the shaping touches).
const asset = (over: Partial<any> = {}): any => ({
  id: "a1",
  kitId: null,
  title: "Asset",
  status: "AVAILABLE",
  category: null,
  location: null,
  tags: [],
  qrCodes: [],
  barcodes: [],
  kit: null,
  ...over,
});

const baseParams = {
  rawKits: [] as any[],
  search: null as string | null,
  orderBy: "status",
  orderDirection: "desc" as const,
  page: 1,
  perPage: 20,
  partialCheckinDetails: {},
  bookingStatus: "ONGOING",
};

describe("shapeBookingAssets", () => {
  it("returns all items with status-desc default order (checked-out last)", () => {
    const rawAssets = [
      asset({ id: "available", status: "AVAILABLE", title: "B" }),
      asset({ id: "checkedout", status: "CHECKED_OUT", title: "A" }),
    ];
    const { items, totalPaginationItems } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
    });
    expect(totalPaginationItems).toBe(2);
    // Actionable (AVAILABLE) on top; CHECKED_OUT sinks to the bottom.
    expect(items.map((i) => i.id)).toEqual(["available", "checkedout"]);
  });

  it("treats partially-checked-in assets as actionable, not checked out", () => {
    const rawAssets = [
      asset({ id: "fully-out", status: "CHECKED_OUT", title: "A" }),
      asset({ id: "partial", status: "CHECKED_OUT", title: "B" }),
    ];
    const { items } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      // A partial check-in entry flips the context status to
      // PARTIALLY_CHECKED_IN for an ONGOING booking -> top bucket.
      partialCheckinDetails: {
        partial: { checkinDate: "2026-01-01T00:00:00.000Z" },
      } as any,
    });
    expect(items.map((i) => i.id)).toEqual(["partial", "fully-out"]);
  });

  it("keeps a QT row with a partial return underway on top, even when its global status is CHECKED_OUT", () => {
    // A QT asset can be globally CHECKED_OUT (e.g. units out in another active
    // booking) while THIS booking has a return underway. The badge shows the
    // actionable partial state, so the status sort must NOT sink it with the
    // fully-checked-out rows — the shared resolver keeps sort and badge aligned.
    const rawAssets = [
      asset({
        id: "partial",
        title: "Partial",
        status: "CHECKED_OUT", // global (checked out elsewhere)
        type: "QUANTITY_TRACKED",
        bookedQuantity: 22,
        checkedOutQuantity: 22,
        dispositionedQuantity: 5, // returns underway -> still actionable
      }),
      asset({ id: "done", title: "Done", status: "CHECKED_OUT" }), // fully out
    ];
    const { items } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      orderBy: "status",
      orderDirection: "desc",
      bookingStatus: "ONGOING",
    });
    // Without the shared resolver the QT row would sink via its global
    // CHECKED_OUT status; with it, only the fully-checked-out "done" sinks.
    expect(items.map((i) => i.id)).toEqual(["partial", "done"]);
  });

  it("filters by search (and counts reflect the filtered set)", () => {
    const rawAssets = [
      asset({ id: "a1", title: "MacBook" }),
      asset({ id: "a2", title: "Dock" }),
    ];
    const { items, totalPaginationItems } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      search: "dock",
    });
    expect(totalPaginationItems).toBe(1);
    expect(items.map((i) => i.id)).toEqual(["a2"]);
  });

  it("groups kit assets into a single kit item and attaches the kit from rawKits", () => {
    const rawAssets = [
      asset({
        id: "k1",
        kitId: "kit-1",
        title: "Body",
        kit: { name: "Cam Kit" },
      }),
      asset({
        id: "k2",
        kitId: "kit-1",
        title: "Lens",
        kit: { name: "Cam Kit" },
      }),
      asset({ id: "solo", kitId: null, title: "Tripod" }),
    ];
    const rawKits = [{ id: "kit-1", name: "Cam Kit" }];
    const { items, totalKits, assetsCount } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      rawKits,
    });
    const kitItem = items.find((i) => i.type === "kit");
    expect(kitItem?.assets.map((a: any) => a.id).sort()).toEqual(["k1", "k2"]);
    expect(kitItem?.kit).toEqual({ id: "kit-1", name: "Cam Kit" });
    expect(totalKits).toBe(1);
    expect(assetsCount).toBe(1); // the solo asset
  });

  it("paginates: page 2 with perPage 1 returns the second item", () => {
    const rawAssets = [
      asset({ id: "a1", status: "CHECKED_OUT", title: "A" }),
      asset({ id: "a2", status: "CHECKED_OUT", title: "B" }),
    ];
    const { items, totalPages } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      perPage: 1,
      page: 2,
    });
    expect(totalPages).toBe(2);
    expect(items.map((i) => i.id)).toEqual(["a2"]);
  });

  it("sinks a kit whose QT member is fully checked out per-slice, even when the member's global status is AVAILABLE", () => {
    // Regression: a QUANTITY_TRACKED asset with a kit slice + a standalone
    // slice (44 booked) never flips its GLOBAL status to CHECKED_OUT when only
    // the kit's 22 are out. The sort must still sink the kit using the row's
    // OWN per-slice checkout (checkedOutQuantity >= bookedQuantity), matching
    // what the row badge shows — otherwise a fully-checked-out kit stays on top.
    const rawAssets = [
      asset({ id: "zebra", title: "Zebra", status: "AVAILABLE" }),
      asset({
        id: "pencils",
        title: "Pencils",
        status: "AVAILABLE", // global stays AVAILABLE (multi-slice never flips)
        type: "QUANTITY_TRACKED",
        kitId: "kit-1",
        kit: { name: "Alpha Kit" },
        bookedQuantity: 22,
        checkedOutQuantity: 22,
        dispositionedQuantity: 0,
      }),
    ];
    const rawKits = [{ id: "kit-1", name: "Alpha Kit" }];
    const { items } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      rawKits,
      orderBy: "status",
      orderDirection: "desc",
      bookingStatus: "ONGOING",
    });
    // "Alpha Kit" sorts before "Zebra" alphabetically, so WITHOUT the per-slice
    // fix the kit would wrongly lead. With it, the fully-checked-out kit sinks.
    expect(items.map((i) => i.id)).toEqual(["zebra", "kit-1"]);
  });

  it("sorts by title when orderBy=title", () => {
    const rawAssets = [
      asset({ id: "b", title: "Banana" }),
      asset({ id: "a", title: "Apple" }),
    ];
    const { items } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
      orderBy: "title",
      orderDirection: "asc",
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
