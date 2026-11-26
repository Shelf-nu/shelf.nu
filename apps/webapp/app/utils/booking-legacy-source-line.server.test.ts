/**
 * The "from <Location>" line under a checked-out `LEGACY` pool slice: which
 * slices get it, and that the location names are read only when one does.
 *
 * @see {@link file://./booking-legacy-source-line.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

import {
  legacySourceLocationsBySlice,
  loadLegacySourceLocations,
  type LegacySourceLineSlice,
} from "./booking-legacy-source-line.server";

// @vitest-environment node

// why: db is the integration boundary. The location-name read is the only
// query this module sends; each case sets what it returns and counts calls.
vi.mock("~/database/db.server", () => ({
  db: { location: { findMany: vi.fn() } },
}));

const ORG_ID = "org-1";
const STUDIO = { id: "loc-studio", name: "Studio" };

/** A checked-out standalone `LEGACY` pool slice, with overrides. */
function slice(
  overrides: Partial<LegacySourceLineSlice> = {}
): LegacySourceLineSlice {
  return {
    id: "ba-legacy",
    assetId: "asset-pool",
    asset: { type: "QUANTITY_TRACKED" },
    assetKitId: null,
    sourceKitId: null,
    sourceLocationId: STUDIO.id,
    sourceAllocation: "LEGACY",
    ...overrides,
  };
}

/** A slice planned by source: shows the Location cell, never the line. */
const SOURCED = slice({ id: "ba-sourced", sourceAllocation: "AUTO" });
/** A pool slice not checked out yet: no recorded source. */
const NOT_OUT = slice({ id: "ba-pending", sourceLocationId: null });
/** A kit slice: records the kit's location, never a placement. */
const KIT = slice({ id: "ba-kit", assetKitId: "ak-1", sourceKitId: "kit-1" });
/** An individual asset. */
const INDIVIDUAL = slice({ id: "ba-camera", asset: { type: "INDIVIDUAL" } });

beforeEach(() => {
  vi.mocked(db.location.findMany).mockReset();
  vi.mocked(db.location.findMany).mockResolvedValue([STUDIO] as never);
});

describe("loadLegacySourceLocations", () => {
  it("reads the names of the locations checked-out LEGACY pool slices left from", async () => {
    const names = await loadLegacySourceLocations({
      organizationId: ORG_ID,
      bookingAssets: [slice(), SOURCED],
    });

    expect(names.get(STUDIO.id)).toEqual(STUDIO);
    expect(db.location.findMany).toHaveBeenCalledTimes(1);
    expect(db.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: [STUDIO.id] }, organizationId: ORG_ID },
      select: { id: true, name: true },
    });
  });

  it("sends no query when no checked-out LEGACY pool slice exists", async () => {
    const names = await loadLegacySourceLocations({
      organizationId: ORG_ID,
      bookingAssets: [SOURCED, NOT_OUT, KIT, INDIVIDUAL],
    });

    expect(names.size).toBe(0);
    expect(db.location.findMany).not.toHaveBeenCalled();
  });
});

describe("legacySourceLocationsBySlice", () => {
  const sourceLocationsById = new Map([[STUDIO.id, STUDIO]]);

  it("names the location a LEGACY slice of a multi-placed pool left from", () => {
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [slice()],
        sourceLocationsById,
        manualPlacementCount: () => 2,
        hasSourceCell: () => false,
      })
    ).toEqual({ "ba-legacy": STUDIO });
  });

  it("gives a slice planned by source no line, even with a recorded source", () => {
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [SOURCED],
        sourceLocationsById,
        manualPlacementCount: () => 2,
        hasSourceCell: () => false,
      })
    ).toEqual({});
  });

  it("gives a slice whose Location cell shows its sources no line", () => {
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [slice()],
        sourceLocationsById,
        manualPlacementCount: () => 2,
        hasSourceCell: (id) => id === "ba-legacy",
      })
    ).toEqual({});
  });

  it("says nothing for a pool at one placement, a kit slice or an unresolved location", () => {
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [slice()],
        sourceLocationsById,
        manualPlacementCount: () => 1,
        hasSourceCell: () => false,
      })
    ).toEqual({});
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [KIT],
        sourceLocationsById,
        manualPlacementCount: () => 2,
        hasSourceCell: () => false,
      })
    ).toEqual({});
    expect(
      legacySourceLocationsBySlice({
        bookingAssets: [slice({ sourceLocationId: "loc-elsewhere" })],
        sourceLocationsById,
        manualPlacementCount: () => 2,
        hasSourceCell: () => false,
      })
    ).toEqual({});
  });
});
