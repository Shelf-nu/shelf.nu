import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  countRemainingCheckoutAssets,
  filterBookingAssets,
  groupAndSortAssetsByKit,
  isAssetCheckoutEligible,
  isBookingArchivable,
  shouldPromptEarlyCheckout,
  type SearchableBookingAsset,
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

describe("isBookingArchivable", () => {
  const past = new Date("2020-01-01T00:00:00Z");
  const future = new Date("2999-01-01T00:00:00Z");

  it("allows COMPLETE bookings regardless of end date", () => {
    expect(
      isBookingArchivable({ status: BookingStatus.COMPLETE, to: future })
    ).toBe(true);
    expect(
      isBookingArchivable({ status: BookingStatus.COMPLETE, to: past })
    ).toBe(true);
    expect(
      isBookingArchivable({ status: BookingStatus.COMPLETE, to: null })
    ).toBe(true);
  });

  it("allows RESERVED bookings only once their end date has passed", () => {
    expect(
      isBookingArchivable({ status: BookingStatus.RESERVED, to: past })
    ).toBe(true);
    expect(
      isBookingArchivable({ status: BookingStatus.RESERVED, to: future })
    ).toBe(false);
    expect(
      isBookingArchivable({ status: BookingStatus.RESERVED, to: null })
    ).toBe(false);
  });

  it("never allows checked-out bookings (ONGOING / OVERDUE), even when past due", () => {
    expect(
      isBookingArchivable({ status: BookingStatus.ONGOING, to: past })
    ).toBe(false);
    expect(
      isBookingArchivable({ status: BookingStatus.OVERDUE, to: past })
    ).toBe(false);
  });

  it("never allows DRAFT or CANCELLED bookings", () => {
    expect(isBookingArchivable({ status: BookingStatus.DRAFT, to: past })).toBe(
      false
    );
    expect(
      isBookingArchivable({ status: BookingStatus.CANCELLED, to: past })
    ).toBe(false);
  });

  it("handles ISO date strings the same as Date objects", () => {
    // `to` arrives as a serialized string from client/loader payloads, so the
    // helper must treat an ISO string identically to a Date.
    expect(
      isBookingArchivable({
        status: BookingStatus.RESERVED,
        to: "2020-01-01T00:00:00Z",
      })
    ).toBe(true);
    expect(
      isBookingArchivable({
        status: BookingStatus.RESERVED,
        to: "2999-01-01T00:00:00Z",
      })
    ).toBe(false);
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

describe("filterBookingAssets", () => {
  // Minimal asset builder for search tests — only the searchable fields.
  const asset = (
    over: Partial<SearchableBookingAsset> = {}
  ): SearchableBookingAsset => ({
    id: "a1",
    kitId: null,
    title: "Generic Asset",
    sequentialId: null,
    category: null,
    tags: null,
    location: null,
    qrCodes: null,
    barcodes: null,
    kit: null,
    ...over,
  });

  it("returns all assets unchanged for blank or missing search", () => {
    const assets = [asset({ id: "a1" }), asset({ id: "a2" })];
    expect(filterBookingAssets(assets, "")).toEqual(assets);
    expect(filterBookingAssets(assets, "   ")).toEqual(assets);
    expect(filterBookingAssets(assets, undefined)).toEqual(assets);
  });

  it("matches title case-insensitively as a substring", () => {
    const assets = [
      asset({ id: "a1", title: "MacBook Pro" }),
      asset({ id: "a2", title: "Dell Dock" }),
    ];
    const result = filterBookingAssets(assets, "book");
    expect(result.map((a) => a.id)).toEqual(["a1"]);
  });

  it("matches sequentialId, tag, location, qr id, and barcode value", () => {
    const assets = [
      asset({ id: "seq", sequentialId: "SAM-0042" }),
      asset({ id: "tag", tags: [{ name: "Fragile" }] }),
      asset({ id: "loc", location: { name: "Warehouse A" } }),
      asset({ id: "qr", qrCodes: [{ id: "qr-xyz" }] }),
      asset({ id: "bar", barcodes: [{ value: "BC-999" }] }),
      asset({ id: "none", title: "nothing" }),
    ];
    expect(filterBookingAssets(assets, "0042").map((a) => a.id)).toEqual([
      "seq",
    ]);
    expect(filterBookingAssets(assets, "fragile").map((a) => a.id)).toEqual([
      "tag",
    ]);
    expect(filterBookingAssets(assets, "warehouse").map((a) => a.id)).toEqual([
      "loc",
    ]);
    expect(filterBookingAssets(assets, "qr-xyz").map((a) => a.id)).toEqual([
      "qr",
    ]);
    expect(filterBookingAssets(assets, "bc-999").map((a) => a.id)).toEqual([
      "bar",
    ]);
  });

  it("treats commas as OR across terms", () => {
    const assets = [
      asset({ id: "a1", title: "laptop" }),
      asset({ id: "a2", title: "dock" }),
      asset({ id: "a3", title: "monitor" }),
    ];
    const result = filterBookingAssets(assets, "laptop, dock");
    expect(result.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("re-expands the whole kit when one of its assets matches", () => {
    const assets = [
      asset({ id: "k1", kitId: "kit-1", title: "Camera body" }),
      asset({ id: "k2", kitId: "kit-1", title: "Tripod" }),
      asset({ id: "solo", kitId: null, title: "Unrelated" }),
    ];
    // "camera" only matches k1, but its whole kit (k1 + k2) should surface.
    const result = filterBookingAssets(assets, "camera");
    expect(result.map((a) => a.id)).toEqual(["k1", "k2"]);
  });

  it("matches by a kit-level field (kit location) and surfaces the whole kit", () => {
    const assets = [
      asset({
        id: "k1",
        kitId: "kit-1",
        title: "Camera body",
        kit: { name: "Cam Kit", location: { name: "Studio B" } },
      }),
      asset({
        id: "k2",
        kitId: "kit-1",
        title: "Tripod",
        kit: { name: "Cam Kit", location: { name: "Studio B" } },
      }),
      asset({ id: "solo", kitId: null, title: "Unrelated" }),
    ];
    // Neither asset title matches; the hit comes from kit.location.name.
    const result = filterBookingAssets(assets, "studio");
    expect(result.map((a) => a.id)).toEqual(["k1", "k2"]);
  });

  it("returns an empty array when nothing matches", () => {
    const assets = [asset({ id: "a1", title: "laptop" })];
    expect(filterBookingAssets(assets, "zzz")).toEqual([]);
  });

  it("preserves input order", () => {
    const assets = [
      asset({ id: "a3", title: "match three" }),
      asset({ id: "a1", title: "match one" }),
      asset({ id: "a2", title: "match two" }),
    ];
    const result = filterBookingAssets(assets, "match");
    expect(result.map((a) => a.id)).toEqual(["a3", "a1", "a2"]);
  });
});

describe("isAssetCheckoutEligible", () => {
  const noneCheckedOut = new Set<string>();
  const noneReturned = new Set<string>();

  it("is eligible when AVAILABLE and not checked out or returned", () => {
    expect(
      isAssetCheckoutEligible(
        { id: "a1", status: AssetStatus.AVAILABLE },
        noneCheckedOut,
        noneReturned
      )
    ).toBe(true);
  });

  it("is not eligible when live status is CHECKED_OUT", () => {
    expect(
      isAssetCheckoutEligible(
        { id: "a1", status: AssetStatus.CHECKED_OUT },
        noneCheckedOut,
        noneReturned
      )
    ).toBe(false);
  });

  it("is not eligible when in custody", () => {
    expect(
      isAssetCheckoutEligible(
        { id: "a1", status: AssetStatus.IN_CUSTODY },
        noneCheckedOut,
        noneReturned
      )
    ).toBe(false);
  });

  it("is not eligible when recorded as already checked out (even if AVAILABLE)", () => {
    expect(
      isAssetCheckoutEligible(
        { id: "a1", status: AssetStatus.AVAILABLE },
        new Set(["a1"]),
        noneReturned
      )
    ).toBe(false);
  });

  it("is not eligible when already returned via partial check-in (AVAILABLE again but done)", () => {
    expect(
      isAssetCheckoutEligible(
        { id: "a1", status: AssetStatus.AVAILABLE },
        noneCheckedOut,
        new Set(["a1"])
      )
    ).toBe(false);
  });
});

describe("countRemainingCheckoutAssets", () => {
  it("counts only assets still eligible to check out", () => {
    const bookingAssets = [
      { id: "a1", status: AssetStatus.AVAILABLE },
      { id: "a2", status: AssetStatus.AVAILABLE },
      { id: "a3", status: AssetStatus.CHECKED_OUT },
      { id: "a4", status: AssetStatus.IN_CUSTODY },
    ];
    // a3 is live CHECKED_OUT, a4 is in custody → only a1, a2 remain.
    expect(countRemainingCheckoutAssets(bookingAssets, [], [])).toBe(2);
  });

  it("excludes assets returned via partial check-in from the denominator", () => {
    // The reported bug: 16 booked, 2 returned via check-in must show /14, not
    // /16. Returned assets are AVAILABLE again but must not be re-counted.
    const bookingAssets = Array.from({ length: 16 }, (_, i) => ({
      id: `a${i + 1}`,
      status: AssetStatus.AVAILABLE,
    }));
    expect(countRemainingCheckoutAssets(bookingAssets, [], ["a1", "a2"])).toBe(
      14
    );
  });

  it("excludes already-checked-out (recorded) assets even when AVAILABLE", () => {
    const bookingAssets = [
      { id: "a1", status: AssetStatus.AVAILABLE },
      { id: "a2", status: AssetStatus.AVAILABLE },
    ];
    expect(countRemainingCheckoutAssets(bookingAssets, ["a1"], [])).toBe(1);
  });

  it("returns 0 when nothing is eligible", () => {
    const bookingAssets = [
      { id: "a1", status: AssetStatus.CHECKED_OUT },
      { id: "a2", status: AssetStatus.IN_CUSTODY },
    ];
    expect(countRemainingCheckoutAssets(bookingAssets, [], [])).toBe(0);
  });
});

describe("shouldPromptEarlyCheckout", () => {
  const future = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // well beyond the 15-min buffer
    return d;
  };
  const past = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  };

  it("prompts when the booking is RESERVED and starts in the future", () => {
    expect(shouldPromptEarlyCheckout(BookingStatus.RESERVED, future())).toBe(
      true
    );
  });

  it("does NOT prompt when the booking is already ONGOING (start date fixed)", () => {
    // The reported bug: 'Check out remaining' on an ONGOING booking must not
    // trigger the adjust-start-date prompt.
    expect(shouldPromptEarlyCheckout(BookingStatus.ONGOING, future())).toBe(
      false
    );
  });

  it("does NOT prompt when the booking is OVERDUE", () => {
    expect(shouldPromptEarlyCheckout(BookingStatus.OVERDUE, future())).toBe(
      false
    );
  });

  it("does NOT prompt when RESERVED but the start date has already passed", () => {
    expect(shouldPromptEarlyCheckout(BookingStatus.RESERVED, past())).toBe(
      false
    );
  });
});
