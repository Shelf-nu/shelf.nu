import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import {
  flattenSelectedBookingItems,
  getBookingAssetCheckinLabel,
  getBookingContextAssetStatus,
  isAssetCheckableIn,
  isQtyRowCheckedOutOrFulfilled,
  resolveQtyStockBadgeVariant,
  type AssetWithStatus,
} from "./booking-assets";

/**
 * Minimal stub satisfying `PartialCheckinDetailsType`'s per-asset shape. The
 * concrete values don't influence `getBookingContextAssetStatus`'s branching
 * (only presence of the key does), so we keep this cheap and reuse it.
 */
const partialCheckinStub = {
  checkinDate: new Date("2026-04-01T10:00:00Z"),
  checkedInBy: {
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    displayName: null,
    profilePicture: null,
  },
};

describe("getBookingContextAssetStatus", () => {
  it("returns PARTIALLY_CHECKED_IN for INDIVIDUAL asset with partial checkin on ONGOING booking", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-1",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };
    const partialCheckinDetails: PartialCheckinDetailsType = {
      [asset.id]: partialCheckinStub,
    };

    expect(
      getBookingContextAssetStatus(
        asset,
        partialCheckinDetails,
        BookingStatus.ONGOING
      )
    ).toBe("PARTIALLY_CHECKED_IN");
  });

  it("returns raw asset.status for INDIVIDUAL asset without partial checkin on ONGOING booking", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-2",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.ONGOING)).toBe(
      AssetStatus.CHECKED_OUT
    );
  });

  it("returns raw asset.status for INDIVIDUAL asset on COMPLETE booking even with partial checkin", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-3",
      status: AssetStatus.CHECKED_OUT,
      type: "INDIVIDUAL",
    };
    const partialCheckinDetails: PartialCheckinDetailsType = {
      [asset.id]: partialCheckinStub,
    };

    expect(
      getBookingContextAssetStatus(
        asset,
        partialCheckinDetails,
        BookingStatus.COMPLETE
      )
    ).toBe(AssetStatus.CHECKED_OUT);
  });

  it("overrides QUANTITY_TRACKED asset to AVAILABLE on DRAFT booking despite CHECKED_OUT global status", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-4",
      status: AssetStatus.CHECKED_OUT,
      type: "QUANTITY_TRACKED",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.DRAFT)).toBe(
      AssetStatus.AVAILABLE
    );
  });

  it("does NOT override QUANTITY_TRACKED asset on ONGOING booking — returns raw CHECKED_OUT", () => {
    expect.assertions(1);
    const asset: AssetWithStatus = {
      id: "asset-5",
      status: AssetStatus.CHECKED_OUT,
      type: "QUANTITY_TRACKED",
    };

    expect(getBookingContextAssetStatus(asset, {}, BookingStatus.ONGOING)).toBe(
      AssetStatus.CHECKED_OUT
    );
  });
});

describe("getBookingAssetCheckinLabel", () => {
  const assetId = "asset-1";

  it("labels a still-out asset 'Checked out' for active bookings", () => {
    const checkedIn = new Set<string>(); // nothing checked in yet

    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "ONGOING")).toBe(
      "Checked out"
    );
    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "OVERDUE")).toBe(
      "Checked out"
    );
  });

  it("labels a partially checked-in asset 'Checked in' for active bookings", () => {
    const checkedIn = new Set([assetId]);

    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "ONGOING")).toBe(
      "Checked in"
    );
    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "OVERDUE")).toBe(
      "Checked in"
    );
  });

  it("labels every asset 'Checked in' for final bookings regardless of records", () => {
    // why: COMPLETE/ARCHIVED bookings have all assets returned by definition,
    // even if no partial check-in row exists (e.g. a full check-in).
    const checkedIn = new Set<string>();

    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "COMPLETE")).toBe(
      "Checked in"
    );
    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "ARCHIVED")).toBe(
      "Checked in"
    );
  });

  it("returns blank when check-in does not apply (never checked out)", () => {
    const checkedIn = new Set<string>();

    for (const status of ["DRAFT", "RESERVED", "CANCELLED"]) {
      expect(getBookingAssetCheckinLabel(assetId, checkedIn, status)).toBe("");
    }
  });

  it("keeps cancelled bookings blank even with check-in records", () => {
    // why: cancelBooking returns assets to AVAILABLE when cancelling from
    // ONGOING/OVERDUE, but a RESERVED->CANCELLED booking never checked out.
    // Both collapse to CANCELLED, so status alone can't tell them apart —
    // blank is the only non-misleading label. (Codex review, PR #2579.)
    const checkedIn = new Set([assetId]);

    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "CANCELLED")).toBe(
      ""
    );
  });

  it("only labels the matching asset as checked in", () => {
    const checkedIn = new Set(["asset-other"]);

    expect(getBookingAssetCheckinLabel(assetId, checkedIn, "ONGOING")).toBe(
      "Checked out"
    );
    expect(
      getBookingAssetCheckinLabel("asset-other", checkedIn, "ONGOING")
    ).toBe("Checked in");
  });
});

describe("isAssetCheckableIn", () => {
  // why: only truthiness of partialCheckinDetails[id] is read by the helper,
  // so a minimal cast object is sufficient and avoids coupling to the row shape.
  const noCheckins = {} as PartialCheckinDetailsType;
  const withCheckin = {
    "asset-1": { checkinDate: "2026-01-01T00:00:00.000Z" },
  } as unknown as PartialCheckinDetailsType;

  it("is checkable-in when checked out in an active booking", () => {
    const asset = { id: "asset-1", status: "CHECKED_OUT" };
    expect(isAssetCheckableIn(asset, noCheckins, "ONGOING")).toBe(true);
    expect(isAssetCheckableIn(asset, noCheckins, "OVERDUE")).toBe(true);
  });

  it("is NOT checkable-in when already partially checked in", () => {
    const asset = { id: "asset-1", status: "CHECKED_OUT" };
    expect(isAssetCheckableIn(asset, withCheckin, "ONGOING")).toBe(false);
  });

  it("is NOT checkable-in when the asset was never checked out (available)", () => {
    const asset = { id: "asset-2", status: "AVAILABLE" };
    expect(isAssetCheckableIn(asset, noCheckins, "ONGOING")).toBe(false);
  });
});

describe("flattenSelectedBookingItems", () => {
  const bookingAssets = [
    { id: "asset-1", status: "CHECKED_OUT", kitId: null },
    { id: "asset-2", status: "AVAILABLE", kitId: "kit-1" },
  ];

  it("fills genuine gaps from the booking record while the selected item wins", () => {
    // The selection atom holds the authoritative enriched loader row: its own
    // fields win (status stays AVAILABLE, NOT the record's CHECKED_OUT), and
    // the booking record only fills genuine gaps (kitId, absent on the item).
    const selected = [{ id: "asset-1", title: "Camera", status: "AVAILABLE" }];
    const [result] = flattenSelectedBookingItems(selected, bookingAssets);
    expect(result.status).toBe("AVAILABLE"); // selected item wins
    expect(result.kitId).toBe(null); // filled from booking record
    expect(result.title).toBe("Camera");
  });

  it("returns a direct asset as-is when not in the booking record", () => {
    const selected = [{ id: "missing", title: "Ghost", status: "AVAILABLE" }];
    const [result] = flattenSelectedBookingItems(selected, bookingAssets);
    expect(result.status).toBe("AVAILABLE");
  });

  it("expands a pagination wrapper (type 'asset' with assets array)", () => {
    const selected = [
      { type: "asset", assets: [{ id: "asset-1", title: "Camera" }] },
    ];
    const result = flattenSelectedBookingItems(selected, bookingAssets);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("asset-1");
    expect(result[0].status).toBe("CHECKED_OUT");
  });

  it("flattens a kit entry (type 'kit') with name and _count", () => {
    const selected = [
      {
        type: "kit",
        id: "kit-1",
        kit: { name: "Kit A", _count: { assets: 2 } },
      },
    ];
    const [result] = flattenSelectedBookingItems(selected, bookingAssets);
    expect(result.name).toBe("Kit A");
    expect(result._count).toEqual({ assets: 2 });
  });

  it("returns a traditional kit (name + _count) unchanged", () => {
    const kit = { id: "kit-1", name: "Kit A", _count: { assets: 2 } };
    const [result] = flattenSelectedBookingItems([kit], bookingAssets);
    expect(result).toEqual(kit);
  });

  // A QUANTITY_TRACKED asset can be booked BOTH standalone (kitId null) and
  // inside a kit (kitId set) — two BookingAsset slices sharing one asset.id.
  // The enrichment map keys by bookingAssetId so both slices coexist, and the
  // selected slice's own bookingAssetId/kitId survive the merge.
  const multiSliceBookingAssets = [
    {
      id: "battery",
      bookingAssetId: "ba-standalone",
      status: "CHECKED_OUT",
      kitId: null,
    },
    {
      id: "battery",
      bookingAssetId: "ba-kit",
      status: "CHECKED_OUT",
      kitId: "kit-1",
    },
  ];

  it("preserves a selected STANDALONE slice's kitId:null and its own bookingAssetId when both slices are present", () => {
    const selected = [
      {
        id: "battery",
        title: "Batteries",
        bookingAssetId: "ba-standalone",
        kitId: null,
        status: "AVAILABLE",
      },
    ];
    const [result] = flattenSelectedBookingItems(
      selected,
      multiSliceBookingAssets
    );
    // The kit slice's kitId must NOT clobber the selected standalone slice.
    expect(result.bookingAssetId).toBe("ba-standalone");
    expect(result.kitId).toBe(null);
    expect(result.title).toBe("Batteries");
  });

  it("keeps a selected KIT-MEMBER slice's kitId when both slices are present", () => {
    const selected = [
      {
        id: "battery",
        title: "Batteries",
        bookingAssetId: "ba-kit",
        kitId: "kit-1",
        status: "AVAILABLE",
      },
    ];
    const [result] = flattenSelectedBookingItems(
      selected,
      multiSliceBookingAssets
    );
    expect(result.bookingAssetId).toBe("ba-kit");
    expect(result.kitId).toBe("kit-1");
  });

  it("enriches a legacy item without bookingAssetId via the id fallback", () => {
    // Legacy entries (both selection and booking record) lack bookingAssetId,
    // so the map keys by id and the item is looked up by id — enrichment still
    // works (status filled from the record).
    const legacyBookingAssets = [
      { id: "legacy-asset", status: "CHECKED_OUT", kitId: null },
    ];
    const selected = [{ id: "legacy-asset", title: "Old Camera" }];
    const [result] = flattenSelectedBookingItems(selected, legacyBookingAssets);
    expect(result.status).toBe("CHECKED_OUT");
    expect(result.title).toBe("Old Camera");
  });
});

describe("isQtyRowCheckedOutOrFulfilled", () => {
  it("returns true for CHECKED_OUT, PARTIALLY_CHECKED_IN, and both partial-checkout-qty statuses", () => {
    expect.assertions(4);
    expect(isQtyRowCheckedOutOrFulfilled(AssetStatus.CHECKED_OUT)).toBe(true);
    expect(isQtyRowCheckedOutOrFulfilled("PARTIALLY_CHECKED_IN")).toBe(true);
    expect(isQtyRowCheckedOutOrFulfilled("PARTIALLY_CHECKED_OUT_QTY")).toBe(
      true
    );
    expect(
      isQtyRowCheckedOutOrFulfilled("PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN")
    ).toBe(true);
  });

  it("returns false for AVAILABLE (row never touched the pool yet)", () => {
    expect.assertions(1);
    expect(isQtyRowCheckedOutOrFulfilled(AssetStatus.AVAILABLE)).toBe(false);
  });
});

describe("resolveQtyStockBadgeVariant", () => {
  /**
   * Real case from the feature spec: asset "Boards" has 10 total units.
   * A DIFFERENT booking has 7 out right now but returns before this
   * (not-yet-started) booking's window opens, so `bookable` is the full 10
   * (no in-window conflict) while `physicalNow` is only 3 (7 are literally
   * off the shelf at this instant).
   */
  const boardsAvailability = { bookable: 10, physicalNow: 3 };

  it("(a) returns 'insufficient' when rowQty exceeds bookable, regardless of physicalNow", () => {
    expect.assertions(1);
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 11,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBe("insufficient");
  });

  it("(b) returns 'pending-return' when the booking hasn't started, rowQty fits bookable but exceeds physicalNow", () => {
    expect.assertions(2);
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBe("pending-return");

    // DRAFT counts as "not started" too.
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.DRAFT,
        isKitDriven: false,
      })
    ).toBe("pending-return");
  });

  it("(c) returns null when rowQty fits within physicalNow (no shortfall at all)", () => {
    expect.assertions(1);
    // Also pins the strict-inequality boundary: rowQty (3) === physicalNow
    // (3) exactly — at-capacity is NOT a shortfall.
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 3,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBeNull();
  });

  it("(d) returns null for an already-checked-out-or-fulfilled row even when rowQty exceeds physicalNow", () => {
    expect.assertions(1);
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: boardsAvailability,
        contextStatus: AssetStatus.CHECKED_OUT,
        bookingStatus: BookingStatus.ONGOING,
        isKitDriven: false,
      })
    ).toBeNull();
  });

  it("(e) returns null for a kit-driven row even when rowQty exceeds both figures, while the same standalone row warns", () => {
    expect.assertions(2);
    // A kit holding the asset's last units: the loose pool reads 0/0 because
    // the kit's allocation is already subtracted from both figures.
    const kitAvailability = { bookable: 0, physicalNow: 0 };
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 1,
        availability: kitAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: true,
      })
    ).toBeNull();
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 1,
        availability: kitAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBe("insufficient");
  });

  it("(f) requires every caller to say whether the row is kit-driven", () => {
    // Forgetting the flag on a surface that renders kit members is silent: the
    // row still renders, and still gets a badge, measured against the wrong
    // pool. Nothing observable breaks, so the compiler has to be the guard.
    //
    // The directive below IS that guard: make `isKitDriven` optional again and
    // it stops suppressing anything, so `tsc` fails the build on an unused
    // directive. (Keep any mention of the directive off the start of a comment
    // line — TypeScript reads one there as real, wherever it appears.)
    // @ts-expect-error - isKitDriven is deliberately required
    const variant = resolveQtyStockBadgeVariant({
      rowQty: 1,
      availability: { bookable: 0, physicalNow: 0 },
      contextStatus: AssetStatus.AVAILABLE,
      bookingStatus: BookingStatus.RESERVED,
    });

    // Resolves at runtime without it — which is exactly why the type must object.
    expect(variant).toBe("insufficient");
  });

  it("does not warn amber once the booking has started (ONGOING/OVERDUE) even if rowQty exceeds physicalNow", () => {
    expect.assertions(2);
    // Row itself hasn't drawn from the pool yet (still AVAILABLE
    // contextStatus) but the booking is active — amber only makes sense
    // pre-start, so this must resolve to null, not "pending-return".
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.ONGOING,
        isKitDriven: false,
      })
    ).toBeNull();
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.OVERDUE,
        isKitDriven: false,
      })
    ).toBeNull();
  });

  it("returns null when availability is undefined (loader didn't ship the map, or INDIVIDUAL asset)", () => {
    expect.assertions(1);
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 7,
        availability: undefined,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBeNull();
  });

  it("returns null for a finished booking (COMPLETE/ARCHIVED) even with a genuine shortfall", () => {
    expect.assertions(2);
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 11,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.COMPLETE,
        isKitDriven: false,
      })
    ).toBeNull();
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 11,
        availability: boardsAvailability,
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.ARCHIVED,
        isKitDriven: false,
      })
    ).toBeNull();
  });

  it("treats at-capacity on bookable (rowQty === bookable) as NOT a shortfall (strict inequality)", () => {
    expect.assertions(1);
    // rowQty === bookable AND === physicalNow — no RED (at-capacity is fine)
    // and no AMBER (physicalNow comparison is also strict).
    expect(
      resolveQtyStockBadgeVariant({
        rowQty: 10,
        availability: { bookable: 10, physicalNow: 10 },
        contextStatus: AssetStatus.AVAILABLE,
        bookingStatus: BookingStatus.RESERVED,
        isKitDriven: false,
      })
    ).toBeNull();
  });
});
