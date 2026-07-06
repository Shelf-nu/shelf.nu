import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  countRemainingCheckoutAssets,
  filterBookingAssets,
  groupAndSortAssetsByKit,
  isAssetCheckoutEligible,
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

describe("groupAndSortAssetsByKit", () => {
  describe("grouping behavior", () => {
    it("keeps assets from the same kit contiguous", () => {
      const assets = [
        createAsset("1", "Asset A", "AVAILABLE", "kit-1", "Kit 1"),
        createAsset("2", "Asset B", "AVAILABLE", "kit-2", "Kit 2"),
        createAsset("3", "Asset C", "AVAILABLE", "kit-1", "Kit 1"),
      ];
      const result = groupAndSortAssetsByKit(assets, "title", "asc");
      const kit1 = result
        .map((a, i) => (a.kitId === "kit-1" ? i : -1))
        .filter((i) => i !== -1);
      expect(kit1[1] - kit1[0]).toBe(1);
    });
  });

  describe("sorting by title (flat interleave of kits and assets)", () => {
    it("orders kit units and standalone assets together by name", () => {
      const assets = [
        createAsset("z", "Zebra", "AVAILABLE"),
        createAsset("k", "member", "AVAILABLE", "kit-1", "Alpha Kit"),
        createAsset("c", "Camera", "AVAILABLE"),
        createAsset("d", "member", "AVAILABLE", "kit-2", "Delta Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "title", "asc");
      // Alpha Kit(k) < Camera(c) < Delta Kit(d) < Zebra(z)
      expect(result.map((a) => a.id)).toEqual(["k", "c", "d", "z"]);
    });

    it("reverses order when descending", () => {
      const assets = [
        createAsset("a", "Apple", "AVAILABLE"),
        createAsset("b", "member", "AVAILABLE", "kit-1", "Mango Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "title", "desc");
      expect(result.map((a) => a.id)).toEqual(["b", "a"]); // Mango Kit > Apple
    });
  });

  describe("sorting by status (checked-out sinks to the bottom)", () => {
    it("puts checked-out standalone assets last, actionable first (desc)", () => {
      const assets = [
        createAsset("out", "A", "CHECKED_OUT"),
        createAsset("avail", "B", "AVAILABLE"),
      ];
      const result = groupAndSortAssetsByKit(assets, "status", "desc");
      expect(result.map((a) => a.id)).toEqual(["avail", "out"]);
    });

    it("uses alphabetical name as the secondary sort within a bucket", () => {
      const assets = [
        createAsset("b", "Bravo", "AVAILABLE"),
        createAsset("a", "Alpha", "AVAILABLE"),
      ];
      const result = groupAndSortAssetsByKit(assets, "status", "desc");
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("keeps a kit on top while ANY member is not checked out", () => {
      const assets = [
        createAsset("s", "Solo", "CHECKED_OUT"),
        createAsset("m1", "M1", "CHECKED_OUT", "kit-1", "Kit"),
        createAsset("m2", "M2", "AVAILABLE", "kit-1", "Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "status", "desc");
      // Kit is partially out => actionable => its members precede the
      // fully-checked-out standalone asset. Members ordered avail-first.
      expect(result.map((a) => a.id)).toEqual(["m2", "m1", "s"]);
    });

    it("sinks a kit to the bottom only when ALL members are checked out", () => {
      const assets = [
        createAsset("avail", "Zzz", "AVAILABLE"),
        createAsset("m1", "M1", "CHECKED_OUT", "kit-1", "Kit"),
        createAsset("m2", "M2", "CHECKED_OUT", "kit-1", "Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "status", "desc");
      expect(result.map((a) => a.id)).toEqual(["avail", "m1", "m2"]);
    });

    it("swaps the buckets when ascending (checked-out first)", () => {
      const assets = [
        createAsset("avail", "A", "AVAILABLE"),
        createAsset("out", "B", "CHECKED_OUT"),
      ];
      const result = groupAndSortAssetsByKit(assets, "status", "asc");
      expect(result.map((a) => a.id)).toEqual(["out", "avail"]);
    });

    it("respects a custom isCheckedOut predicate", () => {
      const assets = [
        createAsset("x", "X", "AVAILABLE"),
        createAsset("y", "Y", "AVAILABLE"),
      ];
      // Treat "x" as checked out even though its raw status is AVAILABLE.
      const result = groupAndSortAssetsByKit(assets, "status", "desc", {
        isCheckedOut: (a) => a.id === "x",
      });
      expect(result.map((a) => a.id)).toEqual(["y", "x"]);
    });
  });

  describe("sorting by item type", () => {
    it("groups kits first then assets (desc)", () => {
      const assets = [
        createAsset("solo", "Solo", "AVAILABLE"),
        createAsset("m", "member", "AVAILABLE", "kit-1", "Kit A"),
      ];
      const result = groupAndSortAssetsByKit(assets, "type", "desc");
      expect(result.map((a) => a.id)).toEqual(["m", "solo"]);
    });

    it("groups assets first then kits (asc)", () => {
      const assets = [
        createAsset("m", "member", "AVAILABLE", "kit-1", "Kit A"),
        createAsset("solo", "Solo", "AVAILABLE"),
      ];
      const result = groupAndSortAssetsByKit(assets, "type", "asc");
      expect(result.map((a) => a.id)).toEqual(["solo", "m"]);
    });

    it("orders multiple kits and assets alphabetically within their bucket", () => {
      const assets = [
        createAsset("z", "Zebra", "AVAILABLE"),
        createAsset("a", "Apple", "AVAILABLE"),
        createAsset("kb", "member", "AVAILABLE", "kit-b", "Beta Kit"),
        createAsset("ka", "member", "AVAILABLE", "kit-a", "Alpha Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "type", "desc");
      // Kits first (Alpha, Beta), then assets (Apple, Zebra).
      expect(result.map((a) => a.id)).toEqual(["ka", "kb", "a", "z"]);
    });
  });

  describe("sorting by category (flat, nulls last)", () => {
    it("interleaves kits and assets by category, nulls last", () => {
      const assets = [
        createAsset("n", "NoCat", "AVAILABLE"),
        createAsset("m", "member", "AVAILABLE", "kit-1", "Kit", "Beta"),
        createAsset("a", "AlphaCat", "AVAILABLE", null, null, "Alpha"),
      ];
      const result = groupAndSortAssetsByKit(assets, "category", "asc");
      // Alpha(a) < Beta(kit member m) < null(n)
      expect(result.map((a) => a.id)).toEqual(["a", "m", "n"]);
    });
  });

  describe("sorting by location (flat, nulls last)", () => {
    it("interleaves kits and assets by location, nulls last", () => {
      const assets = [
        createAsset("n", "NoLoc", "AVAILABLE"),
        createAsset(
          "m",
          "member",
          "AVAILABLE",
          "kit-1",
          "Kit",
          null,
          null,
          "Warehouse B"
        ),
        createAsset("a", "AtA", "AVAILABLE", null, null, null, "Warehouse A"),
      ];
      const result = groupAndSortAssetsByKit(assets, "location", "asc");
      // Warehouse A(a) < Warehouse B(kit member m) < null(n)
      expect(result.map((a) => a.id)).toEqual(["a", "m", "n"]);
    });
  });

  describe("edge cases", () => {
    it("handles an empty array", () => {
      expect(groupAndSortAssetsByKit([], "title", "asc")).toEqual([]);
    });

    it("handles only individual assets", () => {
      const assets = [
        createAsset("b", "Banana", "AVAILABLE"),
        createAsset("a", "Apple", "AVAILABLE"),
      ];
      const result = groupAndSortAssetsByKit(assets, "title", "asc");
      expect(result.map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("handles only kit assets", () => {
      const assets = [
        createAsset("2", "member", "AVAILABLE", "kit-b", "Beta Kit"),
        createAsset("1", "member", "AVAILABLE", "kit-a", "Alpha Kit"),
      ];
      const result = groupAndSortAssetsByKit(assets, "title", "asc");
      expect(result.map((a) => a.kitId)).toEqual(["kit-a", "kit-b"]);
    });

    it("falls back to status ordering for an unknown orderBy", () => {
      const assets = [
        createAsset("out", "A", "CHECKED_OUT"),
        createAsset("avail", "B", "AVAILABLE"),
      ];
      const result = groupAndSortAssetsByKit(assets, "unknown", "desc");
      expect(result.map((a) => a.id)).toEqual(["avail", "out"]);
    });
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
