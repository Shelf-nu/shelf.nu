/**
 * Tests for the shared, client-safe asset utilities.
 *
 * The `isDirectBookingBlockedByKit` suite pins the rule that a
 * QUANTITY_TRACKED asset's kit membership only claims a *slice* of its pool,
 * so the remaining free-pool units stay directly bookable — the regression a
 * customer hit on the asset overview page's "Book" dropdown.
 *
 * @see {@link file://./utils.ts}
 */

import { describe, expect, it } from "vitest";
import {
  getPrimaryKit,
  getPrimaryLocation,
  isDirectBookingBlockedByKit,
  isQuantityTracked,
} from "./utils";

describe("isQuantityTracked", () => {
  it("recognises the QUANTITY_TRACKED type from an asset or a raw value", () => {
    expect(isQuantityTracked({ type: "QUANTITY_TRACKED" })).toBe(true);
    expect(isQuantityTracked("QUANTITY_TRACKED")).toBe(true);
    expect(isQuantityTracked({ type: "INDIVIDUAL" })).toBe(false);
    expect(isQuantityTracked(null)).toBe(false);
    expect(isQuantityTracked(undefined)).toBe(false);
  });
});

describe("getPrimaryKit / getPrimaryLocation", () => {
  it("returns the first pivot row's relation, or null", () => {
    expect(
      getPrimaryKit({ assetKits: [{ kit: { id: "kit-1" } }] })
    ).toStrictEqual({ id: "kit-1" });
    expect(getPrimaryKit({ assetKits: [] })).toBeNull();
    expect(getPrimaryKit(null)).toBeNull();

    expect(
      getPrimaryLocation({ assetLocations: [{ location: { id: "loc-1" } }] })
    ).toStrictEqual({ id: "loc-1" });
    expect(getPrimaryLocation(undefined)).toBeNull();
  });
});

describe("isDirectBookingBlockedByKit", () => {
  describe("INDIVIDUAL assets", () => {
    it("blocks direct booking when the asset belongs to a kit", () => {
      expect(
        isDirectBookingBlockedByKit({
          type: "INDIVIDUAL",
          assetKits: [{ kit: { id: "kit-1", name: "Camera kit" } }],
        })
      ).toBe(true);
    });

    it("blocks direct booking on the index projection (`kit` scalar)", () => {
      expect(
        isDirectBookingBlockedByKit({
          type: "INDIVIDUAL",
          kit: { id: "kit-1", name: "Camera kit" },
        })
      ).toBe(true);
    });

    it("allows direct booking when the asset belongs to no kit", () => {
      expect(
        isDirectBookingBlockedByKit({ type: "INDIVIDUAL", assetKits: [] })
      ).toBe(false);
      expect(
        isDirectBookingBlockedByKit({ type: "INDIVIDUAL", kit: null })
      ).toBe(false);
    });
  });

  describe("QUANTITY_TRACKED assets", () => {
    it("allows direct booking even when the asset belongs to a kit", () => {
      expect(
        isDirectBookingBlockedByKit({
          type: "QUANTITY_TRACKED",
          assetKits: [{ kit: { id: "kit-1", name: "Camera kit" } }],
        })
      ).toBe(false);
    });

    it("allows direct booking when the asset is spread across several kits", () => {
      // A QT asset legitimately allocates a slice to each of N kits while
      // keeping a free pool — the exact shape the customer report hit.
      expect(
        isDirectBookingBlockedByKit({
          type: "QUANTITY_TRACKED",
          assetKits: [
            { kit: { id: "kit-1", name: "Kit A" } },
            { kit: { id: "kit-2", name: "Kit B" } },
            { kit: { id: "kit-3", name: "Kit C" } },
            { kit: { id: "kit-4", name: "Kit D" } },
          ],
        })
      ).toBe(false);
    });

    it("allows direct booking on the index projection (`kit` scalar)", () => {
      expect(
        isDirectBookingBlockedByKit({
          type: "QUANTITY_TRACKED",
          kit: { id: "kit-1", name: "Camera kit" },
        })
      ).toBe(false);
    });
  });

  it("never blocks when there is no asset to inspect", () => {
    expect(isDirectBookingBlockedByKit(null)).toBe(false);
    expect(isDirectBookingBlockedByKit(undefined)).toBe(false);
  });
});
