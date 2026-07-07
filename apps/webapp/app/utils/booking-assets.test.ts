import { AssetStatus, BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import {
  flattenSelectedBookingItems,
  getBookingAssetCheckinLabel,
  getBookingContextAssetStatus,
  isAssetCheckableIn,
  isAssetCheckableOut,
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

describe("isAssetCheckableOut", () => {
  it("is checkable-out when still booked (available, not in records)", () => {
    const asset = { id: "asset-1", status: "AVAILABLE" };
    expect(isAssetCheckableOut(asset, new Set())).toBe(true);
  });

  it("is NOT checkable-out when the asset status is CHECKED_OUT", () => {
    const asset = { id: "asset-1", status: "CHECKED_OUT" };
    expect(isAssetCheckableOut(asset, new Set())).toBe(false);
  });

  it("is NOT checkable-out when the id is in the per-booking checkout records", () => {
    const asset = { id: "asset-1", status: "AVAILABLE" };
    expect(isAssetCheckableOut(asset, new Set(["asset-1"]))).toBe(false);
  });

  // why: the qty-aware top-off UX hinges on `remainingByAssetId` taking
  // precedence over the binary "already checked out?" signal for
  // QUANTITY_TRACKED rows. These four cases pin down the contract — drop one
  // branch and the bulk dropdown / partial-checkout dialog silently disagree
  // with each other again, which is exactly the bug the option exists to
  // prevent.
  describe("with remainingByAssetId (qty-aware top-off)", () => {
    it("is checkable-out for QT asset with remaining > 0 even when id is in checkedOutAssetIds", () => {
      // Top-off case: the row is "partially checked out" — its id is recorded
      // in the booking's checked-out set — but units remain for this booking,
      // so the user must still be able to check the rest out.
      const asset = {
        id: "asset-1",
        status: "CHECKED_OUT",
        type: "QUANTITY_TRACKED",
      };
      expect(
        isAssetCheckableOut(asset, new Set(["asset-1"]), {
          remainingByAssetId: { "asset-1": 5 },
        })
      ).toBe(true);
    });

    it("is NOT checkable-out for QT asset with remaining = 0", () => {
      // Map present and authoritative: zero remaining means every booked unit
      // is dispositioned, so no further check-out is possible — even if the
      // binary fallback would have said otherwise.
      const asset = {
        id: "asset-1",
        status: "AVAILABLE",
        type: "QUANTITY_TRACKED",
      };
      expect(
        isAssetCheckableOut(asset, new Set(), {
          remainingByAssetId: { "asset-1": 0 },
        })
      ).toBe(false);
    });

    it("falls back to the binary check for QT asset when no map is provided (legacy loaders)", () => {
      // Legacy call sites that haven't been updated to plumb the remaining map
      // through must keep their pre-existing behaviour — the QT branch is
      // strictly opt-in via the options arg.
      const asset = {
        id: "asset-1",
        status: "CHECKED_OUT",
        type: "QUANTITY_TRACKED",
      };
      expect(isAssetCheckableOut(asset, new Set())).toBe(false);
    });

    it("ignores remainingByAssetId for INDIVIDUAL assets (binary check only)", () => {
      // The QT branch is gated on `type === "QUANTITY_TRACKED"`. An INDIVIDUAL
      // asset whose id happens to appear in the map must still resolve via the
      // binary fallback — anything else would let a top-off bug leak into
      // single-unit assets.
      const asset = {
        id: "asset-1",
        status: "CHECKED_OUT",
        type: "INDIVIDUAL",
      };
      expect(
        isAssetCheckableOut(asset, new Set(), {
          remainingByAssetId: { "asset-1": 5 },
        })
      ).toBe(false);
    });
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
