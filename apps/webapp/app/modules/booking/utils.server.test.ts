/**
 * Tests for booking check-in progress calculation utilities.
 *
 * Focuses on {@link calculateUnitCheckinProgress}, which powers the workspace
 * `countKitsAsSingleUnit` setting: kits are counted as a single unit and a kit
 * is only "checked in" when ALL of its assets are checked in.
 *
 * @see {@link file://./utils.server.ts}
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
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
    // INDIVIDUAL assets are indivisible — they can never land in Partial.
    // Regression guard: the bucket must stay empty even with mixed live states.
    expect(p.partialCount).toBe(0);
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

/**
 * Quantity-tracked bucketing — asset-level lifecycle bucketing where each
 * QT row contributes exactly ONE count to exactly ONE bucket (NOT a per-unit
 * split). The bucket is decided by a priority chain on (B, C, D):
 *
 *   - Returned:    D >= B  (every booked unit accounted for)
 *   - CheckedOut:  C >= B AND D < B  (every unit out, none back)
 *   - Partial:     0 < C < B  OR  0 < D < B  (mid-flight; QT only)
 *   - Booked:      everything else
 *
 * `totalUnits` is therefore an ASSET COUNT (or kit-unit count in unit mode),
 * not a sum of physical unit quantities. The new `partialCount` field is the
 * fourth bucket; INDIVIDUAL assets can never land in it.
 */
describe("calculateBookingLifecycleProgress (quantity-tracked)", () => {
  /** Convenience builder for a QT row's full lifecycle payload. */
  const QT = (
    id: string,
    booked: number,
    checkedOut: number,
    dispositioned: number,
    kitId: string | null = null,
    status: AssetStatus = AssetStatus.AVAILABLE
  ) => ({
    id,
    kitId,
    status,
    assetType: AssetType.QUANTITY_TRACKED,
    bookedQuantity: booked,
    checkedOutQuantity: checkedOut,
    dispositionedQuantity: dispositioned,
  });

  it("qty asset partially checked out alongside an individual still booked", () => {
    // pencils: 0 < C(5) < B(50) → Partial. macbook: INDIVIDUAL, idle → Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("pencils", 50, 5, 0),
        {
          id: "macbook",
          kitId: null,
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(2);
    expect(p.bookedCount).toBe(1);
    expect(p.partialCount).toBe(1);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.checkoutProgressCount).toBe(1); // partial + fullyOut + returned
    expect(p.checkoutProgressPercentage).toBe(50);
    expect(p.checkinProgressCount).toBe(0);
    expect(p.checkinProgressPercentage).toBe(0);
    expect(p.hasPartialCheckouts).toBe(true);
    expect(p.hasPartialCheckins).toBe(false);
    expect(p.countMode).toBe("assets");
  });

  it("qty asset fully checked out — C >= B with D < B → CheckedOut bucket", () => {
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("pencils", 50, 50, 0)],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(0);
    expect(p.checkedOutCount).toBe(1);
    expect(p.returnedCount).toBe(0);
    expect(p.checkoutProgressCount).toBe(1);
    expect(p.checkoutProgressPercentage).toBe(100);
    expect(p.checkinProgressCount).toBe(0);
    expect(p.checkinProgressPercentage).toBe(0);
    expect(p.hasPartialCheckouts).toBe(true);
    expect(p.hasPartialCheckins).toBe(false);
  });

  it("qty asset quick-checked-out — CHECKED_OUT status with no progressive records → CheckedOut", () => {
    // A quick / all-at-once checkout sets the asset status to CHECKED_OUT but
    // writes NO PartialBookingCheckout rows, so `checkedOutQuantity` stays 0.
    // The bucketer must trust the live CHECKED_OUT status as "all booked units
    // out" (mirrors individualBucketOf) — otherwise the row reads as Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("gloves", 100, 0, 0, null, AssetStatus.CHECKED_OUT)],
      checkedInAssetIds: [],
      checkedOutAssetIds: [],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(0);
    expect(p.checkedOutCount).toBe(1);
    expect(p.returnedCount).toBe(0);
  });

  it("qty asset CHECKED_OUT globally but this booking has progressive records → stays Booked", () => {
    // Global CHECKED_OUT status can come from a DIFFERENT overlapping booking
    // for a shared QT asset. Because THIS booking has progressive records
    // (checkedOutAssetIds non-empty), the all-at-once fallback must NOT fire —
    // trust the per-row counter, so this un-scanned row stays Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("gloves", 100, 0, 0, null, AssetStatus.CHECKED_OUT)],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["some-other-asset"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(1);
    expect(p.checkedOutCount).toBe(0);
  });

  it("qty asset with partial checkout AND partial returns — still Partial (one asset, one bucket)", () => {
    // C=5, D=2, B=50. D >= B? no. C >= B? no. 0 < C < B → Partial.
    // The row collapses to a single bucket — the asset is mid-flight.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("pencils", 50, 5, 2)],
      checkedInAssetIds: ["pencils"],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(1);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.checkoutProgressCount).toBe(1);
    expect(p.checkoutProgressPercentage).toBe(100);
    expect(p.checkinProgressCount).toBe(0);
    expect(p.checkinProgressPercentage).toBe(0);
    expect(p.hasPartialCheckouts).toBe(true);
    expect(p.hasPartialCheckins).toBe(false);
  });

  it("COMPLETE booking with qty partial — collapses to Returned (any units ever out)", () => {
    // At COMPLETE, any QT row with C>0 collapses to Returned. macbook was
    // ever checked out → Returned. partial/checkedOut are 0 by construction.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("pencils", 50, 10, 10),
        {
          id: "macbook",
          kitId: null,
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: ["pencils", "macbook"],
      checkedOutAssetIds: ["pencils", "macbook"],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.totalUnits).toBe(2);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(2);
    expect(p.checkoutProgressCount).toBe(2);
    expect(p.checkoutProgressPercentage).toBe(100);
    expect(p.checkinProgressCount).toBe(2);
    expect(p.checkinProgressPercentage).toBe(100);
    expect(p.hasPartialCheckouts).toBe(true);
    expect(p.hasPartialCheckins).toBe(true);
  });

  it("COMPLETE booking with qty residual checkout (C>D) — collapses to Returned", () => {
    // C=10 > 0 at COMPLETE → asset collapses to Returned; never per-unit math.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("pencils", 50, 10, 7)],
      checkedInAssetIds: ["pencils"],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(1);
    expect(p.checkoutProgressPercentage).toBe(100);
    expect(p.checkinProgressPercentage).toBe(100);
  });

  it("COMPLETE booking with a quick-checked-out QT row (no records) → Returned", () => {
    // A quick checkout leaves no PartialBookingCheckout rows, so an empty
    // checkedOutAssetIds means everything was checked out. The QT row (C=0)
    // must still collapse to Returned at COMPLETE, mirroring INDIVIDUAL rows
    // (which use `wasCheckedOut`). Before the fix it read as Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("gloves", 100, 0, 0)],
      checkedInAssetIds: ["gloves"],
      checkedOutAssetIds: [],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.returnedCount).toBe(1);
    expect(p.bookedCount).toBe(0);
  });

  it("COMPLETE multi-slice QT — never-checked-out slice stays Booked when records exist", () => {
    // checkedOutAssetIds is asset-level; with progressive records present a
    // checked-out slice must NOT drag a sibling never-checked-out slice into
    // Returned. Each slice uses its own C.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("gloves", 50, 50, 0, "K1"), // slice checked out
        QT("gloves", 30, 0, 0, null), // sibling slice never checked out
      ],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["gloves"],
      bookingStatus: BookingStatus.COMPLETE,
    });
    expect(p.totalUnits).toBe(2);
    expect(p.returnedCount).toBe(1); // the checked-out slice
    expect(p.bookedCount).toBe(1); // the never-checked-out slice
  });

  it("qty asset with two slices (kit-driven + standalone) — each slice is its own asset count", () => {
    // Slice 1: QT in K1, 0 < C(2) < B(5) → Partial.
    // Slice 2: QT standalone, C=0, D=0 → Booked.
    // k1asset: INDIVIDUAL, not checked in → Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("pencils", 5, 2, 0, "K1"),
        QT("pencils", 3, 0, 0, null),
        {
          id: "k1asset",
          kitId: "K1",
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(3); // each row is one asset count
    expect(p.bookedCount).toBe(2); // standalone QT slice + k1asset
    expect(p.partialCount).toBe(1); // kit-driven QT slice
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.hasPartialCheckouts).toBe(true);
  });

  it("unit mode with a QT kit member — Partial member promotes the kit to Partial", () => {
    // K1 contains a Partial QT slice → whole kit-unit becomes Partial regardless
    // of its INDIVIDUAL member. Standalone INDIVIDUAL → Booked.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("pencils", 5, 2, 0, "K1"),
        {
          id: "k1asset",
          kitId: "K1",
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
        {
          id: "standalone",
          kitId: null,
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: [],
      checkedOutAssetIds: ["pencils"],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(2); // 1 kit unit + 1 standalone
    expect(p.bookedCount).toBe(1); // standalone
    expect(p.partialCount).toBe(1); // K1 kit (promoted by QT member)
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
    expect(p.countMode).toBe("units");
  });

  it("unit mode: kit with a quick-checked-out QT member + checked-out individuals → kit Fully out", () => {
    // Reproduces the booking-overview bug: a kit whose QT member was quick
    // checked out (status CHECKED_OUT, checkedOutQuantity 0) alongside fully
    // checked-out INDIVIDUAL members must collapse to ONE Fully-out unit. Before
    // the fix the QT member read as Booked, so the kit's members disagreed and
    // the kit fell through to Booked (the "1 item not checked out" symptom).
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        QT("gloves", 100, 0, 0, "KIT", AssetStatus.CHECKED_OUT),
        {
          id: "individual-asset",
          kitId: "KIT",
          status: AssetStatus.CHECKED_OUT,
          assetType: AssetType.INDIVIDUAL,
        },
        {
          id: "saradomin",
          kitId: "KIT",
          status: AssetStatus.CHECKED_OUT,
          assetType: AssetType.INDIVIDUAL,
        },
        {
          id: "standalone",
          kitId: null,
          status: AssetStatus.CHECKED_OUT,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: [],
      checkedOutAssetIds: [],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(2); // 1 kit unit + 1 standalone
    expect(p.checkedOutCount).toBe(2); // kit fully out + standalone
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(0);
    expect(p.returnedCount).toBe(0);
  });

  it("unit mode with an INDIVIDUAL-only kit — kit-as-1-unit collapse still applies (regression guard)", () => {
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [
        {
          id: "k1a",
          kitId: "K",
          status: AssetStatus.CHECKED_OUT,
          assetType: AssetType.INDIVIDUAL,
        },
        {
          id: "k1b",
          kitId: "K",
          status: AssetStatus.CHECKED_OUT,
          assetType: AssetType.INDIVIDUAL,
        },
        {
          id: "standalone",
          kitId: null,
          status: AssetStatus.AVAILABLE,
          assetType: AssetType.INDIVIDUAL,
        },
      ],
      checkedInAssetIds: ["standalone"],
      checkedOutAssetIds: [],
      bookingStatus: BookingStatus.ONGOING,
      countKitsAsSingleUnit: true,
    });
    expect(p.totalUnits).toBe(2); // 1 kit unit + 1 standalone
    expect(p.checkedOutCount).toBe(1);
    expect(p.returnedCount).toBe(1);
    expect(p.bookedCount).toBe(0);
    // INDIVIDUAL-only kit can never produce a Partial bucket — regression guard.
    expect(p.partialCount).toBe(0);
  });

  it("legacy callsite with no qty fields — falls back to INDIVIDUAL math (back-compat)", () => {
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [{ id: "a1", kitId: null, status: AssetStatus.AVAILABLE }],
      checkedInAssetIds: [],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(1);
    expect(p.partialCount).toBe(0);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
  });

  it("qty defensive — D > C with both below B still resolves to Partial (one bucket)", () => {
    // B=10, C=5, D=8: D < B (no Returned), C < B (no CheckedOut),
    // 0 < C < B → Partial. The defensive D>C input does not split the asset.
    const p = calculateBookingLifecycleProgress({
      bookingAssets: [QT("p", 10, 5, 8)],
      checkedInAssetIds: ["p"],
      checkedOutAssetIds: ["p"],
      bookingStatus: BookingStatus.ONGOING,
    });
    expect(p.totalUnits).toBe(1);
    expect(p.bookedCount).toBe(0);
    expect(p.partialCount).toBe(1);
    expect(p.checkedOutCount).toBe(0);
    expect(p.returnedCount).toBe(0);
  });
});
