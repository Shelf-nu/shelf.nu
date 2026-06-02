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
  partialCheckinDetails: {} as any,
};

describe("shapeBookingAssets", () => {
  it("returns all items when no search, with status-desc default order (CHECKED_OUT first)", () => {
    const rawAssets = [
      asset({ id: "available", status: "AVAILABLE", title: "B" }),
      asset({ id: "checkedout", status: "CHECKED_OUT", title: "A" }),
    ];
    const { items, totalPaginationItems } = shapeBookingAssets({
      ...baseParams,
      rawAssets,
    });
    expect(totalPaginationItems).toBe(2);
    // CHECKED_OUT must come before AVAILABLE
    expect(items.map((i) => i.id)).toEqual(["checkedout", "available"]);
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
