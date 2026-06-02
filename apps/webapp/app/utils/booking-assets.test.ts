import { describe, expect, it } from "vitest";

import { getBookingAssetCheckinLabel } from "./booking-assets";

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
