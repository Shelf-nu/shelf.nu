/**
 * Unit tests for `buildQuantityData` — the mapping from the shared
 * `getAssetAvailability` primitive's current-state (unwindowed) result into
 * the `QuantityData` shape the asset overview sidebar renders.
 *
 * This is the regression test for GitHub #2724: the asset overview's
 * headline "Available" figure used to be computed inline in the loader as
 * `total - inKits - operatorCustody - reserved - checkedOut`, where
 * `reserved` was a GLOBAL, un-windowed sum of every active booking
 * reservation (including reservations far in the future that never
 * compete for the SAME physical units). For an asset with total quantity
 * 10 and two non-overlapping standalone reservations of 7 units each
 * (14 total), the old formula reported `Available -4` (and worse in the
 * real production case that inspired #2724, `-11`) even though 10 units
 * were sitting on the shelf, physically untouched, right now.
 *
 * `buildQuantityData` is a pure function (no I/O, no mocks needed): it maps
 * `AssetAvailability.physicalAvailable` straight onto the headline
 * `available` field, so the fix is verified by construction — there is no
 * formula left in this module that can re-introduce the bug by summing
 * `reserved` back into `available`.
 *
 * @see {@link file://./quantity-overview.server.ts}
 * @see {@link file://./availability.server.ts} - Where `physicalAvailable`/`reservedTotal` are computed
 * @see {@link file://./availability.server.test.ts} - Primitive-level coverage of the bb1/bb2 peak-sweep math
 */
import { describe, expect, it } from "vitest";
import type { AssetAvailability } from "./availability.server";
import { buildQuantityData } from "./quantity-overview.server";

/** Builds a full `AssetAvailability` fixture, allowing per-test overrides. */
function makeAvailability(
  overrides: Partial<AssetAvailability> = {}
): AssetAvailability {
  return {
    total: 10,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    reserved: 0,
    reservedTotal: 0,
    reservingBookingCount: 0,
    physicalAvailable: 10,
    bookable: 10,
    ...overrides,
  };
}

describe("buildQuantityData", () => {
  it("maps physicalAvailable onto the headline `available` — never the old negative formula (#2724)", () => {
    // bb1/bb2 fixture: asset total 10, custody 0, kits 0, checked-out 0,
    // two non-overlapping standalone RESERVED rows of 7 units each. Called
    // with NO window (current-state mode, as the overview loader does), so
    // `getAssetAvailability` reports the plain informational sum for
    // `reservedTotal` (14) while `physicalAvailable` stays 10 — the units
    // are still sitting on the shelf, unaffected by future reservations.
    const availability = makeAvailability({
      total: 10,
      inCustody: 0,
      inKits: 0,
      checkedOut: 0,
      reserved: 14,
      reservedTotal: 14,
      reservingBookingCount: 2,
      physicalAvailable: 10,
      bookable: -4,
    });

    const quantityData = buildQuantityData({ availability, inLocations: 0 });

    // The old inline formula (`total - inKits - custody - reserved -
    // checkedOut`) would have reported `10 - 0 - 0 - 14 - 0 = -4` here —
    // negative, and the real #2724 report was `-11` on a differently
    // shaped asset. Either way, "Available" must never go negative just
    // because reservations exist for later dates.
    expect(quantityData.available).toBe(10);
    expect(quantityData.reserved).toBe(14);
    expect(quantityData.reservingBookingCount).toBe(2);
  });

  it("keeps `available` and `custodyAvailable` numerically converged (both source physicalAvailable)", () => {
    const availability = makeAvailability({ physicalAvailable: 7 });

    const quantityData = buildQuantityData({ availability, inLocations: 0 });

    expect(quantityData.available).toBe(7);
    expect(quantityData.custodyAvailable).toBe(7);
  });

  it("passes through total/inCustody/inKits/checkedOut unchanged from the primitive", () => {
    const availability = makeAvailability({
      total: 25,
      inCustody: 3,
      inKits: 4,
      checkedOut: 2,
      physicalAvailable: 16,
    });

    const quantityData = buildQuantityData({ availability, inLocations: 9 });

    expect(quantityData.total).toBe(25);
    expect(quantityData.inCustody).toBe(3);
    expect(quantityData.inKits).toBe(4);
    expect(quantityData.checkedOut).toBe(2);
    // `inLocations` comes from the caller (loader), not the primitive.
    expect(quantityData.inLocations).toBe(9);
  });

  it("reports zero reservations/count when nothing is reserved", () => {
    const availability = makeAvailability();

    const quantityData = buildQuantityData({ availability, inLocations: 0 });

    expect(quantityData.reserved).toBe(0);
    expect(quantityData.reservingBookingCount).toBe(0);
  });
});
