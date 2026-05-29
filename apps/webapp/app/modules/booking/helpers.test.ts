import { describe, it, expect } from "vitest";
import {
  buildBookingAssetsSearchOR,
  getBookingAssetsOrderBy,
  groupAndSortAssetsByKit,
} from "./helpers";

// Helper to create test assets, shared across all describe blocks
const createAsset = (
  id: string,
  title: string,
  status: string,
  kitId: string | null = null,
  kitName: string | null = null,
  categoryName: string | null = null,
  locationName: string | null = null,
  kitLocationName: string | null = null
) => ({
  id,
  title,
  status,
  kitId,
  kit: kitName
    ? {
        name: kitName,
        location: kitLocationName ? { name: kitLocationName } : null,
      }
    : null,
  category: categoryName ? { name: categoryName } : null,
  location: locationName ? { name: locationName } : null,
});

describe("getBookingAssetsOrderBy", () => {
  it("returns status ordering by default", () => {
    const result = getBookingAssetsOrderBy();
    expect(result).toEqual([{ status: "desc" }, { createdAt: "asc" }]);
  });

  it("returns status ordering when orderBy is 'status'", () => {
    const result = getBookingAssetsOrderBy("status", "desc");
    expect(result).toEqual([{ status: "desc" }, { createdAt: "asc" }]);
  });

  it("returns status ordering with asc direction", () => {
    const result = getBookingAssetsOrderBy("status", "asc");
    expect(result).toEqual([{ status: "asc" }, { createdAt: "asc" }]);
  });

  it("returns title ordering when orderBy is 'title'", () => {
    const result = getBookingAssetsOrderBy("title", "desc");
    expect(result).toEqual([{ title: "desc" }]);
  });

  it("returns title ordering with asc direction", () => {
    const result = getBookingAssetsOrderBy("title", "asc");
    expect(result).toEqual([{ title: "asc" }]);
  });

  it("returns category ordering when orderBy is 'category'", () => {
    const result = getBookingAssetsOrderBy("category", "desc");
    expect(result).toEqual([{ category: { name: "desc" } }]);
  });

  it("falls back to status ordering for unknown orderBy values", () => {
    const result = getBookingAssetsOrderBy("unknown", "desc");
    expect(result).toEqual([{ status: "desc" }, { createdAt: "asc" }]);
  });

  it("returns location ordering when orderBy is 'location'", () => {
    const result = getBookingAssetsOrderBy("location", "asc");
    expect(result).toEqual([{ location: { name: "asc" } }]);
  });
});

describe("groupAndSortAssetsByKit", () => {
  describe("grouping behavior", () => {
    it("groups assets by kit and places kits before individual assets", () => {
      const assets = [
        createAsset("1", "Individual Asset", "AVAILABLE"),
        createAsset("2", "Kit Asset 1", "AVAILABLE", "kit-1", "Kit A"),
        createAsset("3", "Kit Asset 2", "AVAILABLE", "kit-1", "Kit A"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      // Kit assets should come first, then individual assets
      expect(result[0].kitId).toBe("kit-1");
      expect(result[1].kitId).toBe("kit-1");
      expect(result[2].kitId).toBeNull();
    });

    it("keeps assets from the same kit together", () => {
      const assets = [
        createAsset("1", "Asset A", "AVAILABLE", "kit-1", "Kit 1"),
        createAsset("2", "Asset B", "AVAILABLE", "kit-2", "Kit 2"),
        createAsset("3", "Asset C", "AVAILABLE", "kit-1", "Kit 1"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      // Find positions of kit-1 assets
      const kit1Positions = result
        .map((a, i) => (a.kitId === "kit-1" ? i : -1))
        .filter((i) => i !== -1);

      // They should be adjacent
      expect(kit1Positions[1] - kit1Positions[0]).toBe(1);
    });
  });

  describe("sorting by title", () => {
    it("sorts kits by kit name ascending", () => {
      const assets = [
        createAsset("1", "Asset", "AVAILABLE", "kit-b", "Kit B"),
        createAsset("2", "Asset", "AVAILABLE", "kit-a", "Kit A"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      expect(result[0].kit?.name).toBe("Kit A");
      expect(result[1].kit?.name).toBe("Kit B");
    });

    it("sorts kits by kit name descending", () => {
      const assets = [
        createAsset("1", "Asset", "AVAILABLE", "kit-a", "Kit A"),
        createAsset("2", "Asset", "AVAILABLE", "kit-b", "Kit B"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "desc");

      expect(result[0].kit?.name).toBe("Kit B");
      expect(result[1].kit?.name).toBe("Kit A");
    });

    it("sorts assets within kits by title", () => {
      const assets = [
        createAsset("1", "Zebra", "AVAILABLE", "kit-1", "Kit"),
        createAsset("2", "Apple", "AVAILABLE", "kit-1", "Kit"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      expect(result[0].title).toBe("Apple");
      expect(result[1].title).toBe("Zebra");
    });

    it("sorts individual assets by title", () => {
      const assets = [
        createAsset("1", "Zebra", "AVAILABLE"),
        createAsset("2", "Apple", "AVAILABLE"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      expect(result[0].title).toBe("Apple");
      expect(result[1].title).toBe("Zebra");
    });
  });

  describe("sorting by status", () => {
    it("sorts kits by most urgent status (CHECKED_OUT first when desc)", () => {
      const assets = [
        createAsset("1", "Asset", "AVAILABLE", "kit-a", "Kit A"),
        createAsset("2", "Asset", "CHECKED_OUT", "kit-b", "Kit B"),
      ];

      const result = groupAndSortAssetsByKit(assets, "status", "desc");

      // Kit B has CHECKED_OUT which is more urgent
      expect(result[0].kit?.name).toBe("Kit B");
      expect(result[1].kit?.name).toBe("Kit A");
    });

    it("sorts assets within kits by status", () => {
      const assets = [
        createAsset("1", "Asset A", "AVAILABLE", "kit-1", "Kit"),
        createAsset("2", "Asset B", "CHECKED_OUT", "kit-1", "Kit"),
      ];

      const result = groupAndSortAssetsByKit(assets, "status", "desc");

      expect(result[0].status).toBe("CHECKED_OUT");
      expect(result[1].status).toBe("AVAILABLE");
    });

    it("uses title as secondary sort for same status", () => {
      const assets = [
        createAsset("1", "Zebra", "AVAILABLE"),
        createAsset("2", "Apple", "AVAILABLE"),
      ];

      const result = groupAndSortAssetsByKit(assets, "status", "desc");

      expect(result[0].title).toBe("Apple");
      expect(result[1].title).toBe("Zebra");
    });
  });

  describe("sorting by category", () => {
    it("sorts kits by first asset's category", () => {
      const assets = [
        createAsset("1", "Asset", "AVAILABLE", "kit-a", "Kit A", "Zebra Cat"),
        createAsset("2", "Asset", "AVAILABLE", "kit-b", "Kit B", "Apple Cat"),
      ];

      const result = groupAndSortAssetsByKit(assets, "category", "asc");

      expect(result[0].kit?.name).toBe("Kit B"); // Apple Cat comes first
      expect(result[1].kit?.name).toBe("Kit A");
    });

    it("sorts individual assets by category", () => {
      const assets = [
        createAsset("1", "Asset A", "AVAILABLE", null, null, "Zebra"),
        createAsset("2", "Asset B", "AVAILABLE", null, null, "Apple"),
      ];

      const result = groupAndSortAssetsByKit(assets, "category", "asc");

      expect(result[0].category?.name).toBe("Apple");
      expect(result[1].category?.name).toBe("Zebra");
    });

    it("handles null categories (sorts to end)", () => {
      const assets = [
        createAsset("1", "Asset A", "AVAILABLE", null, null, null),
        createAsset("2", "Asset B", "AVAILABLE", null, null, "Apple"),
      ];

      const result = groupAndSortAssetsByKit(assets, "category", "asc");

      expect(result[0].category?.name).toBe("Apple");
      expect(result[1].category).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles empty array", () => {
      const result = groupAndSortAssetsByKit([], "title", "asc");
      expect(result).toEqual([]);
    });

    it("handles array with only individual assets", () => {
      const assets = [
        createAsset("1", "Asset B", "AVAILABLE"),
        createAsset("2", "Asset A", "AVAILABLE"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("Asset A");
      expect(result[1].title).toBe("Asset B");
    });

    it("handles array with only kit assets", () => {
      const assets = [
        createAsset("1", "Asset B", "AVAILABLE", "kit-1", "Kit"),
        createAsset("2", "Asset A", "AVAILABLE", "kit-1", "Kit"),
      ];

      const result = groupAndSortAssetsByKit(assets, "title", "asc");

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe("Asset A");
      expect(result[1].title).toBe("Asset B");
    });

    it("uses default values when orderBy is unknown", () => {
      const assets = [
        createAsset("1", "Asset", "AVAILABLE"),
        createAsset("2", "Asset", "CHECKED_OUT"),
      ];

      const result = groupAndSortAssetsByKit(assets, "unknown", "desc");

      // Falls back to status sorting
      expect(result[0].status).toBe("CHECKED_OUT");
      expect(result[1].status).toBe("AVAILABLE");
    });
  });
});

describe("groupAndSortAssetsByKit — location", () => {
  it("sorts individual assets by location name ascending", () => {
    const assets = [
      createAsset("1", "A", "AVAILABLE", null, null, null, "Warehouse B"),
      createAsset("2", "B", "AVAILABLE", null, null, null, "Warehouse A"),
    ];

    const result = groupAndSortAssetsByKit(assets, "location", "asc");

    expect(result[0].location?.name).toBe("Warehouse A");
    expect(result[1].location?.name).toBe("Warehouse B");
  });

  it("places assets with no location at the end regardless of direction", () => {
    const assets = [
      createAsset("1", "NoLoc", "AVAILABLE"),
      createAsset("2", "HasLoc", "AVAILABLE", null, null, null, "Shelf 1"),
    ];

    const ascResult = groupAndSortAssetsByKit(assets, "location", "asc");
    expect(ascResult[0].location?.name).toBe("Shelf 1");
    expect(ascResult[1].location).toBeNull();

    const descResult = groupAndSortAssetsByKit(assets, "location", "desc");
    expect(descResult[1].location).toBeNull();
  });

  it("sorts kit groups by the kit's own location", () => {
    const assets = [
      createAsset(
        "1",
        "A",
        "AVAILABLE",
        "kit-z",
        "Kit Z",
        null,
        null,
        "Zone Z"
      ),
      createAsset(
        "2",
        "B",
        "AVAILABLE",
        "kit-a",
        "Kit A",
        null,
        null,
        "Zone A"
      ),
    ];

    const result = groupAndSortAssetsByKit(assets, "location", "asc");

    expect(result[0].kit?.name).toBe("Kit A");
    expect(result[1].kit?.name).toBe("Kit Z");
  });
});

describe("buildBookingAssetsSearchOR", () => {
  it("produces one OR group per comma-separated term", () => {
    const result = buildBookingAssetsSearchOR("laptop, dock");
    expect(result).toHaveLength(2);
  });

  it("matches asset title, location, and kit location for a term", () => {
    const [group] = buildBookingAssetsSearchOR("warehouse");
    const json = JSON.stringify(group);
    expect(json).toContain('"title"');
    expect(json).toContain('"location"');
    expect(json).toContain('"sequentialId"');
    expect(json).toContain('"kit"');
    expect(json).toContain("warehouse");
  });

  it("returns an empty array for blank search", () => {
    expect(buildBookingAssetsSearchOR("   ")).toEqual([]);
  });
});
