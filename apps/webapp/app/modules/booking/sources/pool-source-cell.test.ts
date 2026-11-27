/**
 * Pool source cell selector tests: which booking rows show their sources in
 * the Location cell (standalone pool slices allocated by source) and which
 * keep the ordinary cell.
 *
 * Pure: no mocks.
 *
 * @see {@link file://./pool-source-cell.ts}
 */

import type { BookingSourcePart } from "@shelf/quantity-control";
import { describe, expect, it } from "vitest";
import {
  isStandalonePoolSlice,
  selectPoolSourceCell,
} from "./pool-source-cell";

/** Builds a display part with neutral defaults. */
function part(overrides: Partial<BookingSourcePart>): BookingSourcePart {
  return {
    key: "LOCATION:loc-a",
    kind: "LOCATION",
    locationId: "loc-a",
    label: "Demo Warehouse",
    planned: 8,
    out: 0,
    short: false,
    ...overrides,
  };
}

const WAREHOUSE = part({});
const UNPLACED = part({
  key: "UNPLACED",
  kind: "UNPLACED",
  locationId: null,
  label: "Unplaced",
  planned: 7,
  out: 2,
});
const UNASSIGNED = part({
  key: "UNASSIGNED",
  kind: "UNASSIGNED",
  locationId: null,
  label: "Needs a location",
  planned: 3,
  short: true,
});

describe("selectPoolSourceCell", () => {
  const base = {
    isStandalonePoolSlice: true,
    hasPlacements: true,
  };

  it("returns the parts of an allocated standalone pool slice", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [WAREHOUSE], mode: "AUTO" },
      })
    ).toEqual({ parts: [WAREHOUSE] });
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [WAREHOUSE, UNPLACED], mode: "MANUAL" },
      })
    ).toEqual({ parts: [WAREHOUSE, UNPLACED] });
  });

  it("keeps the ordinary cell for LEGACY and KIT slices", () => {
    for (const mode of ["LEGACY", "KIT"] as const) {
      expect(
        selectPoolSourceCell({
          ...base,
          summary: { parts: [WAREHOUSE], mode },
        })
      ).toBeNull();
    }
  });

  it("keeps the ordinary cell for individual assets and kit rows", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        isStandalonePoolSlice: false,
        summary: { parts: [WAREHOUSE], mode: "AUTO" },
      })
    ).toBeNull();
    expect(selectPoolSourceCell({ ...base, summary: undefined })).toBeNull();
  });

  it("keeps the ordinary cell when there is nothing to show", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [], mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("keeps the ordinary cell for a pool with no placements drawing from Unplaced", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasPlacements: false,
        summary: { parts: [UNPLACED], mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("shows Unplaced for a pool placed only through kits", () => {
    // The row's Location cell would name the kit's location, which these
    // loose units do not come from; the caller counts kit-driven placements.
    expect(
      selectPoolSourceCell({
        ...base,
        hasPlacements: true,
        summary: { parts: [UNPLACED], mode: "AUTO" },
      })
    ).toEqual({ parts: [UNPLACED] });
  });

  it("still shows a pool with no placements that needs a location", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasPlacements: false,
        summary: { parts: [UNASSIGNED], mode: "AUTO" },
      })
    ).toEqual({ parts: [UNASSIGNED] });
  });
});

describe("isStandalonePoolSlice", () => {
  it("counts a quantity-tracked slice with no live kit", () => {
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: null,
      })
    ).toBe(true);
  });

  it("counts units left behind when the asset left its kit", () => {
    // `sourceKitId` is provenance only; the slice is AUTO and standalone.
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: null,
        sourceKitId: "kit-1",
      } as { asset: { type: string }; assetKitId: string | null })
    ).toBe(true);
  });

  it("rejects kit-driven slices and individual assets", () => {
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: "ak-1",
      })
    ).toBe(false);
    expect(
      isStandalonePoolSlice({ asset: { type: "INDIVIDUAL" }, assetKitId: null })
    ).toBe(false);
  });
});
