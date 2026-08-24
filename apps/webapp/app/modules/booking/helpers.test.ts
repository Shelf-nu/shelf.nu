import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  buildPdfAssetRows,
  buildPdfBookingAssetSlices,
  countRemainingCheckoutAssets,
  filterBookingAssets,
  groupAndSortAssetsByKit,
  hasAssetBookingConflicts,
  isAssetCheckoutEligible,
  isBookingArchivable,
  shouldPromptEarlyCheckout,
  type PdfBookingAssetSlice,
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

describe("hasAssetBookingConflicts", () => {
  /** Builds the minimal asset shape the helper reads. */
  const assetWith = (
    status: string,
    bookings: Array<{ id: string; status: string }>,
    type = "INDIVIDUAL"
  ) => ({
    status,
    type,
    bookingAssets: bookings.map((booking) => ({ booking })),
  });

  const CURRENT = "booking-current";

  it("treats an overlapping RESERVED booking as a conflict by default", () => {
    const asset = assetWith(AssetStatus.AVAILABLE, [
      { id: "other", status: BookingStatus.RESERVED },
    ]);
    expect(hasAssetBookingConflicts(asset, CURRENT)).toBe(true);
  });

  it("ignores an ONGOING booking while the asset is not physically checked out", () => {
    const asset = assetWith(AssetStatus.AVAILABLE, [
      { id: "other", status: BookingStatus.ONGOING },
    ]);
    expect(hasAssetBookingConflicts(asset, CURRENT)).toBe(false);
  });

  it("treats an ONGOING booking as a conflict once the asset is CHECKED_OUT", () => {
    const asset = assetWith(AssetStatus.CHECKED_OUT, [
      { id: "other", status: BookingStatus.ONGOING },
    ]);
    expect(hasAssetBookingConflicts(asset, CURRENT)).toBe(true);
  });

  it("never conflicts on the current booking's own rows", () => {
    const asset = assetWith(AssetStatus.CHECKED_OUT, [
      { id: CURRENT, status: BookingStatus.ONGOING },
    ]);
    expect(hasAssetBookingConflicts(asset, CURRENT)).toBe(false);
  });

  describe("ignoreReservedConflicts", () => {
    // The reported bug: a booking that is already ONGOING could never check out
    // its remaining assets once ANY overlapping RESERVED booking held them —
    // and that reservation was itself allowed precisely because this booking
    // had not physically checked the asset out yet. An in-flight booking
    // outranks a reservation that has taken nothing.
    it("does NOT conflict on a RESERVED booking when reserved conflicts are ignored", () => {
      const asset = assetWith(AssetStatus.AVAILABLE, [
        { id: "other", status: BookingStatus.RESERVED },
      ]);
      expect(
        hasAssetBookingConflicts(asset, CURRENT, {
          ignoreReservedConflicts: true,
        })
      ).toBe(false);
    });

    it("still conflicts when the asset is physically CHECKED_OUT elsewhere", () => {
      // The flag must not disarm the guard wholesale — an asset genuinely out
      // on another in-flight booking is not on the shelf to be handed over.
      const asset = assetWith(AssetStatus.CHECKED_OUT, [
        { id: "other", status: BookingStatus.OVERDUE },
      ]);
      expect(
        hasAssetBookingConflicts(asset, CURRENT, {
          ignoreReservedConflicts: true,
        })
      ).toBe(true);
    });

    it("leaves QUANTITY_TRACKED assets to the service-layer quantity guards", () => {
      const asset = assetWith(
        AssetStatus.AVAILABLE,
        [{ id: "other", status: BookingStatus.RESERVED }],
        "QUANTITY_TRACKED"
      );
      expect(hasAssetBookingConflicts(asset, CURRENT)).toBe(false);
    });
  });
});

describe("buildPdfAssetRows", () => {
  /** Full per-asset data joined onto each slice by {@link buildPdfAssetRows}. */
  type RawPdfAsset = {
    id: string;
    title: string;
    status: string;
    /** Workspace stock — must NOT leak into a row's booked quantity. */
    quantity: number | null;
    category: { name: string } | null;
    assetKits: Array<{
      id: string;
      kit: {
        id: string;
        name: string;
        location: { name: string } | null;
      } | null;
    }>;
    assetLocations: Array<{ location: { name: string } | null }>;
  };

  const rawAsset = (over: Partial<RawPdfAsset> = {}): RawPdfAsset => ({
    id: "asset",
    title: "Asset",
    status: "AVAILABLE",
    quantity: null,
    category: null,
    assetKits: [],
    assetLocations: [],
    ...over,
  });

  it("renders one row per BookingAsset slice for a QT asset booked standalone + via two kits", () => {
    // Boards = 4 standalone + 3 via kit b1 + 3 via kit b2. The PDF must mirror
    // the on-screen overview: THREE rows, each with its own quantity and kit,
    // never one summed row. `Asset.quantity` (workspace stock = 100) must not
    // become the booked quantity.
    const boards = rawAsset({
      id: "boards",
      title: "Boards",
      quantity: 100,
      assetKits: [
        {
          id: "ak-b1", // AssetKit.id (the slice discriminator)
          kit: { id: "kit-b1", name: "b1", location: { name: "Warehouse" } },
        },
        { id: "ak-b2", kit: { id: "kit-b2", name: "b2", location: null } },
      ],
      assetLocations: [{ location: { name: "Shelf A" } }],
    });
    const rawAssetsById = new Map([["boards", boards]]);

    // Each slice carries its `BookingAsset.assetKitId` (an AssetKit.id);
    // buildPdfAssetRows matches it against the asset's `assetKits[].id`, and the
    // OUTPUT row's `kitId` is the resolved Kit.id. `sourceKitId` holds that same
    // `Kit.id` durably, and agrees with the membership while it lives.
    const slices: PdfBookingAssetSlice[] = [
      {
        id: "boards",
        assetKitId: null,
        sourceKitId: null,
        quantity: 4,
        bookingAssetId: "ba-standalone",
      },
      {
        id: "boards",
        assetKitId: "ak-b1",
        sourceKitId: "kit-b1",
        quantity: 3,
        bookingAssetId: "ba-b1",
      },
      {
        id: "boards",
        assetKitId: "ak-b2",
        sourceKitId: "kit-b2",
        quantity: 3,
        bookingAssetId: "ba-b2",
      },
    ];

    const rows = buildPdfAssetRows(slices, rawAssetsById);

    expect(
      rows.map((r) => ({
        bookingAssetId: r.bookingAssetId,
        quantity: r.quantity,
        kitId: r.kitId,
        kitName: r.kit?.name ?? null,
      }))
    ).toEqual([
      {
        bookingAssetId: "ba-standalone",
        quantity: 4,
        kitId: null,
        kitName: null,
      },
      { bookingAssetId: "ba-b1", quantity: 3, kitId: "kit-b1", kitName: "b1" },
      { bookingAssetId: "ba-b2", quantity: 3, kitId: "kit-b2", kitName: "b2" },
    ]);
    // Booked slice quantity wins over the asset's 100-unit workspace stock.
    expect(rows.some((r) => r.quantity === 100)).toBe(false);
    // Primary location resolves from the `AssetLocation` pivot.
    expect(rows[0].location).toEqual({ name: "Shelf A" });
  });

  it("renders a single quantity-1 row for an INDIVIDUAL asset", () => {
    const laptop = rawAsset({ id: "laptop", title: "Laptop" });
    const rows = buildPdfAssetRows(
      [
        {
          id: "laptop",
          assetKitId: null,
          sourceKitId: null,
          quantity: 1,
          bookingAssetId: "ba-laptop",
        },
      ],
      new Map([["laptop", laptop]])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Laptop",
      quantity: 1,
      kit: null,
      kitId: null,
      bookingAssetId: "ba-laptop",
    });
  });

  it("skips a slice whose asset didn't resolve instead of crashing", () => {
    const rows = buildPdfAssetRows(
      [
        {
          id: "ghost",
          assetKitId: null,
          sourceKitId: null,
          quantity: 2,
          bookingAssetId: "ba-ghost",
        },
      ],
      new Map<string, RawPdfAsset>()
    );

    expect(rows).toEqual([]);
  });

  it("produces rows that group by kit without collapsing duplicate asset ids", () => {
    // End-to-end: the per-slice rows must survive `groupAndSortAssetsByKit`
    // (which groups by the resolved kit id and never dedupes asset ids), so
    // all three Boards slices remain distinct rows.
    const boards = rawAsset({
      id: "boards",
      title: "Boards",
      assetKits: [
        { id: "ak-b1", kit: { id: "kit-b1", name: "b1", location: null } },
        { id: "ak-b2", kit: { id: "kit-b2", name: "b2", location: null } },
      ],
    });
    const rows = buildPdfAssetRows(
      [
        {
          id: "boards",
          assetKitId: null,
          sourceKitId: null,
          quantity: 4,
          bookingAssetId: "ba-standalone",
        },
        {
          id: "boards",
          assetKitId: "ak-b1",
          sourceKitId: "kit-b1",
          quantity: 3,
          bookingAssetId: "ba-b1",
        },
        {
          id: "boards",
          assetKitId: "ak-b2",
          sourceKitId: "kit-b2",
          quantity: 3,
          bookingAssetId: "ba-b2",
        },
      ],
      new Map([["boards", boards]])
    );

    const sorted = groupAndSortAssetsByKit(rows, "title", "asc");

    expect(sorted).toHaveLength(3);
    expect(sorted.map((r) => r.bookingAssetId).sort()).toEqual([
      "ba-b1",
      "ba-b2",
      "ba-standalone",
    ]);
  });

  it("renders a detached slice under its original kit via sourceKitId", () => {
    // The asset has since been removed from the kit: its `AssetKit` row is
    // gone (so `assetKits` is empty and `assetKitId` was `SET NULL`'d), but
    // the finished booking must still describe the job as containing that
    // kit rather than a loose asset.
    const tripod = rawAsset({ id: "tripod", title: "Tripod" });

    const rows = buildPdfAssetRows(
      [
        {
          id: "tripod",
          assetKitId: null,
          sourceKitId: "kit-camera",
          quantity: 1,
          bookingAssetId: "ba-tripod",
        },
      ],
      new Map([["tripod", tripod]]),
      new Map([
        [
          "kit-camera",
          {
            id: "kit-camera",
            name: "Camera Kit",
            location: { name: "Studio" },
          },
        ],
      ])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bookingAssetId: "ba-tripod",
      kitId: "kit-camera",
      kit: {
        id: "kit-camera",
        name: "Camera Kit",
        location: { name: "Studio" },
      },
    });
  });

  it("leaves a detached slice standalone when its source kit is not resolvable", () => {
    // `sourceKitId`'s FK accepts a `Kit` in any organization, so the caller's
    // lookup is org-scoped and can legitimately come back empty. That must
    // degrade to a loose row, never crash.
    const tripod = rawAsset({ id: "tripod", title: "Tripod" });

    const rows = buildPdfAssetRows(
      [
        {
          id: "tripod",
          assetKitId: null,
          sourceKitId: "kit-other-org",
          quantity: 1,
          bookingAssetId: "ba-tripod",
        },
      ],
      new Map([["tripod", tripod]])
    );

    expect(rows[0]).toMatchObject({ kitId: null, kit: null });
  });

  it("prefers the live membership over the snapshot kit", () => {
    // While the membership lives the two agree, but the live join stays the
    // source of truth — a renamed/moved kit must render from current data.
    const boards = rawAsset({
      id: "boards",
      assetKits: [
        {
          id: "ak-b1",
          kit: { id: "kit-b1", name: "b1 (live)", location: null },
        },
      ],
    });

    const rows = buildPdfAssetRows(
      [
        {
          id: "boards",
          assetKitId: "ak-b1",
          sourceKitId: "kit-b1",
          quantity: 3,
          bookingAssetId: "ba-b1",
        },
      ],
      new Map([["boards", boards]]),
      new Map([
        [
          "kit-b1",
          { id: "kit-b1", name: "b1 (stale)", location: { name: "Nowhere" } },
        ],
      ])
    );

    expect(rows[0].kit).toEqual({
      id: "kit-b1",
      name: "b1 (live)",
      location: null,
    });
  });

  describe("isRemovedFromKit (printed residue marker)", () => {
    /** The snapshot map every case below resolves `kit-camera` through. */
    const cameraSnapshot = new Map([
      ["kit-camera", { id: "kit-camera", name: "Camera Kit", location: null }],
    ]);

    it("flags a slice whose asset has genuinely left the kit", () => {
      // Membership gone (`assetKits` empty, `assetKitId` SET NULL'd) but the
      // slice still renders under `kit-camera` via `sourceKitId` — the printed
      // row must say so, or it reads as a live kit member.
      const rows = buildPdfAssetRows(
        [
          {
            id: "tripod",
            assetKitId: null,
            sourceKitId: "kit-camera",
            quantity: 1,
            bookingAssetId: "ba-tripod",
          },
        ],
        new Map([["tripod", rawAsset({ id: "tripod", title: "Tripod" })]]),
        cameraSnapshot
      );

      expect(rows[0]).toMatchObject({
        kitId: "kit-camera",
        isRemovedFromKit: true,
      });
    });

    it("does not flag a live kit member", () => {
      const tripod = rawAsset({
        id: "tripod",
        assetKits: [
          {
            id: "ak-camera",
            kit: { id: "kit-camera", name: "Camera Kit", location: null },
          },
        ],
      });

      const rows = buildPdfAssetRows(
        [
          {
            id: "tripod",
            assetKitId: "ak-camera",
            sourceKitId: "kit-camera",
            quantity: 1,
            bookingAssetId: "ba-tripod",
          },
        ],
        new Map([["tripod", tripod]]),
        cameraSnapshot
      );

      expect(rows[0].isRemovedFromKit).toBe(false);
    });

    it("does not flag a standalone slice", () => {
      const rows = buildPdfAssetRows(
        [
          {
            id: "laptop",
            assetKitId: null,
            sourceKitId: null,
            quantity: 1,
            bookingAssetId: "ba-laptop",
          },
        ],
        new Map([["laptop", rawAsset({ id: "laptop", title: "Laptop" })]]),
        cameraSnapshot
      );

      expect(rows[0].isRemovedFromKit).toBe(false);
    });

    it("does not flag an asset that was re-added to the same kit", () => {
      // Re-adding creates a NEW `AssetKit` row the nulled slice never points
      // at, so the row still resolves through the snapshot — but the asset IS
      // a current member again, so calling it removed would be a lie.
      const tripod = rawAsset({
        id: "tripod",
        assetKits: [
          {
            id: "ak-camera-new",
            kit: { id: "kit-camera", name: "Camera Kit", location: null },
          },
        ],
      });

      const rows = buildPdfAssetRows(
        [
          {
            id: "tripod",
            assetKitId: null,
            sourceKitId: "kit-camera",
            quantity: 1,
            bookingAssetId: "ba-tripod",
          },
        ],
        new Map([["tripod", tripod]]),
        cameraSnapshot
      );

      // Still grouped under the kit, just not marked as removed.
      expect(rows[0]).toMatchObject({
        kitId: "kit-camera",
        isRemovedFromKit: false,
      });
    });
  });

  it("returns an empty array for no slices", () => {
    expect(buildPdfAssetRows([], new Map<string, RawPdfAsset>())).toEqual([]);
  });
});

describe("buildPdfBookingAssetSlices", () => {
  /** Minimal `BookingAsset`-with-`asset` row the projection reads. */
  const bookingAssetRow = (over: {
    id: string;
    quantity?: number;
    assetKitId?: string | null;
    sourceKitId?: string | null;
    asset: {
      id: string;
      title: string;
      assetKits?: Array<{
        id: string;
        kit: {
          id: string;
          name: string;
          location: { name: string } | null;
        } | null;
      }>;
      assetLocations?: Array<{ location: { name: string } | null }>;
    };
  }) => ({
    id: over.id,
    quantity: over.quantity ?? 1,
    assetKitId: over.assetKitId ?? null,
    // Defaults to null so these cases exercise the LIVE membership path; the
    // `sourceKitId` fallback only engages once the membership is gone.
    sourceKitId: over.sourceKitId ?? null,
    asset: { assetKits: [], assetLocations: [], ...over.asset },
  });

  it("sets kitId to the shared Kit.id, NOT the per-membership AssetKit.id (#2790)", () => {
    // The bug: `kitId` held the `AssetKit.id` (unique per asset-in-kit), so
    // `filterBookingAssets`' kit re-expansion never surfaced siblings on search.
    // It must be the shared `Kit.id`; the `AssetKit.id` is kept as `assetKitId`.
    const slices = buildPdfBookingAssetSlices([
      bookingAssetRow({
        id: "ba-1",
        assetKitId: "ak-cable-in-b1",
        asset: {
          id: "cable",
          title: "Cable",
          assetKits: [
            {
              id: "ak-cable-in-b1",
              kit: { id: "kit-b1", name: "b1", location: null },
            },
          ],
        },
      }),
    ]);

    expect(slices[0].kitId).toBe("kit-b1"); // Kit.id — not "ak-cable-in-b1"
    expect(slices[0].assetKitId).toBe("ak-cable-in-b1");
    expect(slices[0].kit).toEqual({ id: "kit-b1", name: "b1", location: null });
  });

  it("leaves kitId, assetKitId and kit null for a standalone slice", () => {
    const slices = buildPdfBookingAssetSlices([
      bookingAssetRow({
        id: "ba-std",
        assetKitId: null,
        asset: { id: "cable", title: "Cable" },
      }),
    ]);
    expect(slices[0].kitId).toBeNull();
    expect(slices[0].assetKitId).toBeNull();
    expect(slices[0].kit).toBeNull();
  });

  it("gives a QT asset booked via two kits two slices: same asset id, different kits", () => {
    const assetKits = [
      { id: "ak-b1", kit: { id: "kit-b1", name: "b1", location: null } },
      { id: "ak-b2", kit: { id: "kit-b2", name: "b2", location: null } },
    ];
    const slices = buildPdfBookingAssetSlices([
      bookingAssetRow({
        id: "ba-b1",
        quantity: 3,
        assetKitId: "ak-b1",
        asset: { id: "boards", title: "Boards", assetKits },
      }),
      bookingAssetRow({
        id: "ba-b2",
        quantity: 3,
        assetKitId: "ak-b2",
        asset: { id: "boards", title: "Boards", assetKits },
      }),
    ]);

    expect(
      slices.map((s) => ({ kitId: s.kitId, assetKitId: s.assetKitId }))
    ).toEqual([
      { kitId: "kit-b1", assetKitId: "ak-b1" },
      { kitId: "kit-b2", assetKitId: "ak-b2" },
    ]);
  });

  it("resolves the primary location from the asset's AssetLocation pivot", () => {
    const slices = buildPdfBookingAssetSlices([
      bookingAssetRow({
        id: "ba-1",
        asset: {
          id: "cable",
          title: "Cable",
          assetLocations: [{ location: { name: "Shelf A" } }],
        },
      }),
    ]);
    expect(slices[0].location).toEqual({ name: "Shelf A" });
  });

  it("feeds filterBookingAssets so a kit-member search re-expands the whole kit (fixed behavior)", () => {
    // Two assets in kit b1 + one unrelated standalone. Searching one kit member
    // by title must surface BOTH kit members (re-expansion by the shared Kit.id)
    // and not the unrelated asset. Before the fix (kitId = AssetKit.id) only the
    // directly-matched member came back.
    const inKitB1 = (id: string, title: string, ak: string) =>
      bookingAssetRow({
        id: `ba-${id}`,
        assetKitId: ak,
        asset: {
          id,
          title,
          assetKits: [
            { id: ak, kit: { id: "kit-b1", name: "b1", location: null } },
          ],
        },
      });

    const slices = buildPdfBookingAssetSlices([
      inKitB1("cam", "Camera body", "ak-cam-b1"),
      inKitB1("tripod", "Tripod", "ak-tripod-b1"),
      bookingAssetRow({
        id: "ba-solo",
        asset: { id: "solo", title: "Unrelated" },
      }),
    ]);

    const filtered = filterBookingAssets(slices, "Camera");
    expect(filtered.map((s) => s.id).sort()).toEqual(["cam", "tripod"]);
  });
});
