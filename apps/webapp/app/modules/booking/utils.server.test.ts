/**
 * Tests for booking check-in progress calculation utilities.
 *
 * Focuses on {@link calculateUnitCheckinProgress}, which powers the workspace
 * `countKitsAsSingleUnit` setting: kits are counted as a single unit and a kit
 * is only "checked in" when ALL of its assets are checked in.
 *
 * @see {@link file://./utils.server.ts}
 */
import { BookingStatus, AssetStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  calculateUnitCheckinProgress,
  calculateBookingLifecycleProgress,
} from "./utils.server";

// why: pure function, no mocks needed — exercises real bucketing logic.
const A = (id: string, status: AssetStatus, kitId: string | null = null) => ({
  id,
  status,
  kitId,
});

/** Convenience builder for a standalone (non-kitted) asset. */
const standalone = (id: string) => ({ id, kitId: null });

/** Convenience builder for an asset belonging to a kit. */
const kitted = (id: string, kitId: string) => ({ id, kitId });

describe("calculateUnitCheckinProgress", () => {
  it("counts standalone-only bookings exactly like asset counting", () => {
    const assets = [standalone("a1"), standalone("a2"), standalone("a3")];

    const result = calculateUnitCheckinProgress(assets, ["a1", "a2"]);

    expect(result.totalAssets).toBe(3);
    expect(result.checkedInCount).toBe(2);
    expect(result.uncheckedCount).toBe(1);
    expect(result.progressPercentage).toBe(67);
    expect(result.hasPartialCheckins).toBe(true);
    expect(result.countMode).toBe("units");
  });

  it("counts a kit with no checked-in assets as 0 of 1", () => {
    const assets = [kitted("a1", "kit1"), kitted("a2", "kit1")];

    const result = calculateUnitCheckinProgress(assets, []);

    expect(result.totalAssets).toBe(1);
    expect(result.checkedInCount).toBe(0);
    expect(result.uncheckedCount).toBe(1);
    expect(result.progressPercentage).toBe(0);
    expect(result.hasPartialCheckins).toBe(false);
  });

  it("does not count a partially checked-in kit as checked in", () => {
    const assets = [
      kitted("a1", "kit1"),
      kitted("a2", "kit1"),
      kitted("a3", "kit1"),
    ];

    // Only some of the kit's assets are checked in -> kit stays unchecked.
    const result = calculateUnitCheckinProgress(assets, ["a1", "a2"]);

    expect(result.totalAssets).toBe(1);
    expect(result.checkedInCount).toBe(0);
    expect(result.uncheckedCount).toBe(1);
    expect(result.progressPercentage).toBe(0);
    // The kit unit is not "checked in", but asset-level check-ins exist, so the
    // booking page must still surface the progress section + per-asset columns.
    expect(result.hasPartialCheckins).toBe(true);
  });

  it("counts a fully checked-in kit as 1 of 1", () => {
    const assets = [kitted("a1", "kit1"), kitted("a2", "kit1")];

    const result = calculateUnitCheckinProgress(assets, ["a1", "a2"]);

    expect(result.totalAssets).toBe(1);
    expect(result.checkedInCount).toBe(1);
    expect(result.uncheckedCount).toBe(0);
    expect(result.progressPercentage).toBe(100);
    expect(result.hasPartialCheckins).toBe(true);
  });

  it("handles mixed standalone + multiple kits with partial states", () => {
    const assets = [
      // 2 standalone assets (a1 checked in, a2 not)
      standalone("a1"),
      standalone("a2"),
      // kit1 fully checked in
      kitted("k1a", "kit1"),
      kitted("k1b", "kit1"),
      // kit2 partially checked in (counts as not checked in)
      kitted("k2a", "kit2"),
      kitted("k2b", "kit2"),
      // kit3 none checked in
      kitted("k3a", "kit3"),
    ];

    const result = calculateUnitCheckinProgress(assets, [
      "a1",
      "k1a",
      "k1b",
      "k2a",
    ]);

    // Units: 2 standalone + 3 kits = 5 total.
    expect(result.totalAssets).toBe(5);
    // Checked in: a1 (standalone) + kit1 (fully) = 2.
    expect(result.checkedInCount).toBe(2);
    expect(result.uncheckedCount).toBe(3);
    expect(result.progressPercentage).toBe(40);
    expect(result.hasPartialCheckins).toBe(true);
  });

  it("handles an empty booking", () => {
    const result = calculateUnitCheckinProgress([], []);

    expect(result.totalAssets).toBe(0);
    expect(result.checkedInCount).toBe(0);
    expect(result.uncheckedCount).toBe(0);
    expect(result.progressPercentage).toBe(0);
    expect(result.hasPartialCheckins).toBe(false);
  });

  it("forces 100% progress for COMPLETE bookings", () => {
    const assets = [
      standalone("a1"),
      kitted("k1a", "kit1"),
      kitted("k1b", "kit1"),
    ];

    // Even though no assets are in the checked-in set, COMPLETE forces 100%.
    const result = calculateUnitCheckinProgress(
      assets,
      [],
      BookingStatus.COMPLETE
    );

    // Units: 1 standalone + 1 kit = 2.
    expect(result.totalAssets).toBe(2);
    expect(result.checkedInCount).toBe(2);
    expect(result.uncheckedCount).toBe(0);
    expect(result.progressPercentage).toBe(100);
    expect(result.hasPartialCheckins).toBe(true);
  });
});

describe("calculateBookingLifecycleProgress (asset mode)", () => {
  it("buckets booked / checked out / returned and computes both percentages", () => {
    const assets = [
      ...Array.from({ length: 4 }, (_, i) => A(`b${i}`, AssetStatus.AVAILABLE)),
      ...Array.from({ length: 6 }, (_, i) =>
        A(`o${i}`, AssetStatus.CHECKED_OUT)
      ),
      ...Array.from({ length: 2 }, (_, i) => A(`r${i}`, AssetStatus.AVAILABLE)),
    ];
    const checkedInAssetIds = ["r0", "r1"];

    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds,
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: false,
    });

    expect(p.totalUnits).toBe(12);
    expect(p.bookedCount).toBe(4);
    expect(p.checkedOutCount).toBe(6);
    expect(p.returnedCount).toBe(2);
    expect(p.checkoutProgressCount).toBe(8);
    expect(p.checkoutProgressPercentage).toBe(67);
    expect(p.checkinProgressCount).toBe(2);
    expect(p.checkinProgressPercentage).toBe(17);
    expect(p.hasPartialCheckouts).toBe(true);
    expect(p.hasPartialCheckins).toBe(true);
    expect(p.countMode).toBe("assets");
  });

  it("a returned asset is never double-counted as checked out", () => {
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [A("x", AssetStatus.AVAILABLE)],
      checkedInAssetIds: ["x"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.returnedCount).toBe(1);
    expect(p.checkedOutCount).toBe(0);
    expect(p.bookedCount).toBe(0);
  });

  it("an empty booking yields zero counts and 0% (no NaN)", () => {
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(0);
    expect(p.checkoutProgressPercentage).toBe(0);
    expect(p.checkinProgressPercentage).toBe(0);
  });

  it("COMPLETE with no checkout records treats every asset as returned / 100%", () => {
    // Empty checkedOutAssetIds means "no progressive-checkout records" → a pure
    // quick/all-at-once checkout where every asset was actually checked out.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        A("a", AssetStatus.AVAILABLE),
        A("b", AssetStatus.AVAILABLE),
      ],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.bookedCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(2);
    expect(p.checkoutProgressPercentage).toBe(100);
    expect(p.checkinProgressPercentage).toBe(100);
  });

  it("DRAFT ignores global CHECKED_OUT status — everything Booked, no progress", () => {
    // Regression: duplicating an ongoing booking creates a DRAFT booking that
    // connects the SAME assets, which are still physically CHECKED_OUT in the
    // original booking. A DRAFT has never been checked out *in this booking*, so
    // the global asset status must not bleed into its lifecycle bar.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        A("a", AssetStatus.CHECKED_OUT),
        A("b", AssetStatus.CHECKED_OUT),
        A("c", AssetStatus.AVAILABLE),
      ],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.DRAFT,
    });
    expect(p.totalUnits).toBe(3);
    expect(p.bookedCount).toBe(3);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.checkoutProgressCount).toBe(0);
    expect(p.checkoutProgressPercentage).toBe(0);
    expect(p.hasPartialCheckouts).toBe(false);
    expect(p.hasPartialCheckins).toBe(false);
  });

  it("RESERVED ignores global CHECKED_OUT status — everything Booked, no progress", () => {
    // A RESERVED booking has never had any of its own assets checked out:
    // progressive checkout's first scan flips RESERVED → ONGOING. So a
    // CHECKED_OUT status here belongs to a different booking (e.g. the asset is
    // reserved for a future window while physically out elsewhere now) and must
    // not register as this booking's checkout progress.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        A("a", AssetStatus.CHECKED_OUT),
        A("b", AssetStatus.AVAILABLE),
      ],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.RESERVED,
    });
    expect(p.bookedCount).toBe(2);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.hasPartialCheckouts).toBe(false);
  });

  it("CANCELLED ignores global CHECKED_OUT status — everything Booked, no progress", () => {
    // A cancelled booking has released its assets; any CHECKED_OUT status comes
    // from a different (live) booking and must not show as this booking's progress.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        A("a", AssetStatus.CHECKED_OUT),
        A("b", AssetStatus.AVAILABLE),
      ],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.CANCELLED,
    });
    expect(p.bookedCount).toBe(2);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.hasPartialCheckouts).toBe(false);
  });

  it("COMPLETE with a checked-out subset marks only that subset returned, the rest booked", () => {
    // Progressive checkout: 4 assets, only 2 were ever checked out. At COMPLETE,
    // the 2 never-checked-out assets must stay Booked (not forced to Returned),
    // and the percentages reflect the 50/50 split (not a hard-coded 100).
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        A("co0", AssetStatus.AVAILABLE),
        A("co1", AssetStatus.AVAILABLE),
        A("never0", AssetStatus.AVAILABLE),
        A("never1", AssetStatus.AVAILABLE),
      ],
      checkedInAssetIds: ["co0", "co1"],
      checkedOutAssetIds: ["co0", "co1"],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.totalUnits).toBe(4);
    expect(p.returnedCount).toBe(2);
    expect(p.bookedCount).toBe(2);
    expect(p.checkedOutCount).toBe(0);
    expect(p.checkoutProgressPercentage).toBe(50);
    expect(p.checkinProgressPercentage).toBe(50);
    expect(p.hasPartialCheckins).toBe(true);
  });
});

describe("calculateBookingLifecycleProgress (unit mode)", () => {
  it("a kit is a unit; bucket only when ALL its assets share a state", () => {
    const assets = [
      A("k1", AssetStatus.CHECKED_OUT, "K"),
      A("k2", AssetStatus.CHECKED_OUT, "K"),
      A("m1", AssetStatus.CHECKED_OUT, "M"),
      A("m2", AssetStatus.AVAILABLE, "M"),
      A("s1", AssetStatus.AVAILABLE, null),
    ];
    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds: ["s1"],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(3);
    expect(p.checkedOutCount).toBe(1);
    expect(p.bookedCount).toBe(1);
    expect(p.returnedCount).toBe(1);
    expect(p.countMode).toBe("units");
  });

  it("a kit whose every asset is returned counts as returned, not booked", () => {
    const assets = [
      A("k1", AssetStatus.AVAILABLE, "K"),
      A("k2", AssetStatus.AVAILABLE, "K"),
    ];
    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds: ["k1", "k2"],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.returnedCount).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
  });

  it("a kit mixing returned + checked out counts as booked", () => {
    const assets = [
      A("k1", AssetStatus.AVAILABLE, "K"),
      A("k2", AssetStatus.CHECKED_OUT, "K"),
    ];
    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds: ["k1"],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(1);
    expect(p.returnedCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
  });

  it("COMPLETE: a kit with only SOME assets ever checked out is Booked, not Returned", () => {
    // Progressive checkout: kit K had k1 checked out but k2 never was. As a unit
    // a kit only "returned" when ALL its assets were checked out (unanimity) —
    // matching the kit-row ReturnedBadge gate. So this kit lands in Booked.
    const assets = [
      A("k1", AssetStatus.AVAILABLE, "K"),
      A("k2", AssetStatus.AVAILABLE, "K"),
    ];
    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds: ["k1"],
      checkedOutAssetIds: ["k1"], // k2 was never checked out
      bookingStatus: BookingStatus.COMPLETE,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(1);
    expect(p.returnedCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
  });

  it("COMPLETE: a kit with EVERY asset checked out is Returned", () => {
    const assets = [
      A("k1", AssetStatus.AVAILABLE, "K"),
      A("k2", AssetStatus.AVAILABLE, "K"),
    ];
    const p = calculateBookingLifecycleProgress({
      bookingAssets: assets,
      checkedInAssetIds: ["k1", "k2"],
      checkedOutAssetIds: ["k1", "k2"], // whole kit was checked out
      bookingStatus: BookingStatus.COMPLETE,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.returnedCount).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
  });
});
