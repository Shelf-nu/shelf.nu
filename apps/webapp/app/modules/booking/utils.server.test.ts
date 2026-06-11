/**
 * Tests for booking check-in progress calculation utilities.
 *
 * Focuses on {@link calculateUnitCheckinProgress}, which powers the workspace
 * `countKitsAsSingleUnit` setting: kits are counted as a single unit and a kit
 * is only "checked in" when ALL of its assets are checked in.
 *
 * @see {@link file://./utils.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import { calculateUnitCheckinProgress } from "./utils.server";

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
