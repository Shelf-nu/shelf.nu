import { describe, expect, it } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import {
  flattenSelectedBookingItems,
  getBookingAssetCheckinLabel,
  isAssetCheckableIn,
  isAssetCheckableOut,
} from "./booking-assets";

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
});

describe("flattenSelectedBookingItems", () => {
  const bookingAssets = [
    { id: "asset-1", status: "CHECKED_OUT", kitId: null },
    { id: "asset-2", status: "AVAILABLE", kitId: "kit-1" },
  ];

  it("enriches a direct asset entry from the booking record", () => {
    // Atom entry carries a stale status; the booking record wins.
    const selected = [{ id: "asset-1", title: "Camera", status: "AVAILABLE" }];
    const [result] = flattenSelectedBookingItems(selected, bookingAssets);
    expect(result.status).toBe("CHECKED_OUT");
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
});
