/**
 * Tests for how a check-in or check-out method is recorded and worded.
 *
 * The method is a claim about what happened at the shelf, so these cases pin
 * the places it must never be invented: a batch with no provenance writes no
 * method keys, a stored meta that says nothing readable reads as null, a
 * ticked row is matched by its slice and never by its asset, and an event
 * covering slices handled in different ways says nothing rather than picking
 * one.
 *
 * @see {@link file://./checkout-method.ts}
 */
import { describe, expect, it } from "vitest";

import {
  bookingMethodClause,
  bookingMethodMeta,
  describeBatchMethod,
  describeBookingMethod,
  describeBookingMethodCapitalised,
  narrowSelectedBookingAssetIds,
  outstandingSliceIds,
  readBookingMethodMeta,
  resolveBookingMethod,
  resolveBookingMethodForSlices,
  scannedRowPredicate,
} from "./checkout-method";

// @vitest-environment node

/** A web scan batch in which the standalone slice was ticked, not scanned. */
const scanBatchWithTick = {
  surface: "web" as const,
  method: "scanned" as const,
  selectedBookingAssetIds: ["ba-standalone"],
};

describe("bookingMethodMeta", () => {
  it("stamps a one-click batch with its method and surface", () => {
    expect(bookingMethodMeta({ surface: "web", method: "quick" })).toEqual({
      method: "quick",
      surface: "web",
    });
  });

  it("records a ticked slice of a scan batch as selected, by slice", () => {
    expect(resolveBookingMethod(scanBatchWithTick, "ba-kit")).toBe("scanned");
    expect(resolveBookingMethod(scanBatchWithTick, "ba-standalone")).toBe(
      "selected"
    );
    // A row posted without a slice can never have been ticked.
    expect(resolveBookingMethod(scanBatchWithTick, undefined)).toBe("scanned");
    expect(resolveBookingMethod(scanBatchWithTick, null)).toBe("scanned");
  });

  it("keeps a null method as null, with the surface still recorded", () => {
    // An older phone bundle declared nothing; the route still knows the phone.
    expect(bookingMethodMeta({ surface: "phone", method: null })).toEqual({
      method: null,
      surface: "phone",
    });
  });

  it("writes no method keys at all without provenance", () => {
    expect(bookingMethodMeta(undefined, ["ba-1"])).toEqual({});
  });
});

describe("resolveBookingMethodForSlices", () => {
  it("gives an asset the one method its slices share", () => {
    expect(
      resolveBookingMethodForSlices(scanBatchWithTick, ["ba-kit", "ba-other"])
    ).toBe("scanned");
    expect(
      resolveBookingMethodForSlices(scanBatchWithTick, ["ba-standalone"])
    ).toBe("selected");
    expect(bookingMethodMeta(scanBatchWithTick, ["ba-standalone"])).toEqual({
      method: "selected",
      surface: "web",
    });
  });

  it("says nothing for an asset whose slices were handled in different ways", () => {
    // One event covers both slices of the pens; it must not claim either way.
    expect(
      resolveBookingMethodForSlices(scanBatchWithTick, [
        "ba-standalone",
        "ba-kit",
      ])
    ).toBeNull();
    expect(
      bookingMethodMeta(scanBatchWithTick, ["ba-standalone", "ba-kit"])
    ).toEqual({ method: null, surface: "web" });
  });

  it("reads as the batch's method when the event names no slices", () => {
    expect(resolveBookingMethodForSlices(scanBatchWithTick, [])).toBe(
      "scanned"
    );
  });
});

describe("narrowSelectedBookingAssetIds", () => {
  it("keeps only the ticked slices the batch submits, once each", () => {
    expect(
      narrowSelectedBookingAssetIds(
        ["ba-2", "ba-2", "ba-9"],
        ["ba-1", "ba-2", undefined, null]
      )
    ).toEqual(["ba-2"]);
  });

  it("is empty without ticked slices", () => {
    expect(narrowSelectedBookingAssetIds(undefined, ["ba-1"])).toEqual([]);
    expect(narrowSelectedBookingAssetIds([], ["ba-1"])).toEqual([]);
  });
});

describe("outstandingSliceIds", () => {
  it("keeps only the slices out and not yet back", () => {
    const at = new Date("2026-09-01T09:00:00.000Z");
    expect(
      outstandingSliceIds([
        { id: "out", checkedOutAt: at, checkedInAt: null },
        { id: "back-earlier", checkedOutAt: at, checkedInAt: at },
        { id: "never-left", checkedOutAt: null, checkedInAt: null },
      ])
    ).toEqual(["out"]);
  });

  it("stops a sibling returned earlier from mixing a ticked batch's method", () => {
    // ba-1 came back scanned earlier; this batch ticked ba-2, the one still
    // out. Over every slice the line would read "scanned and selected".
    const at = new Date("2026-09-01T09:00:00.000Z");
    const provenance = {
      surface: "web" as const,
      method: "scanned" as const,
      selectedBookingAssetIds: ["ba-2"],
    };
    expect(
      bookingMethodClause(
        provenance,
        outstandingSliceIds([
          { id: "ba-1", checkedOutAt: at, checkedInAt: at },
          { id: "ba-2", checkedOutAt: at, checkedInAt: null },
        ])
      )
    ).toBe(" (selected on the web)");
  });
});

describe("scannedRowPredicate", () => {
  const noNames = {
    assetIds: [],
    kitSlices: [],
    kitIds: [],
    addedAssetIds: [],
    claimedAssetIds: [],
  };
  const battery = { id: "batteries", type: "QUANTITY_TRACKED" as const };
  const looseBatteries = {
    asset: battery,
    assetKitId: null,
    sourceKitId: null,
  };
  const kitBatteries = {
    asset: battery,
    assetKitId: "ak-1",
    sourceKitId: "kit-1",
  };

  it("marks only the kit slice when a kit scan adds a slice of an asset the booking already holds loose", () => {
    // The batteries sit loose on the booking; scanning the kit adds its slice
    // of the same asset. Only the kit slice went through the scanner.
    const wasScanned = scannedRowPredicate({
      ...noNames,
      kitSlices: [{ assetId: "batteries", assetKitId: "ak-1" }],
      kitIds: ["kit-1"],
      addedAssetIds: ["batteries"],
    });
    expect(wasScanned(kitBatteries)).toBe(true);
    expect(wasScanned(looseBatteries)).toBe(false);
  });

  it("marks only the standalone slice when the asset itself is scanned", () => {
    const wasScanned = scannedRowPredicate({
      ...noNames,
      assetIds: ["batteries"],
    });
    expect(wasScanned(looseBatteries)).toBe(true);
    expect(wasScanned(kitBatteries)).toBe(false);
  });

  it("marks a kit slice already on the booking when its kit label is scanned", () => {
    // Members already booked: the scan adds no slice, the kit id names it.
    const wasScanned = scannedRowPredicate({ ...noNames, kitIds: ["kit-1"] });
    expect(wasScanned(kitBatteries)).toBe(true);
    expect(wasScanned(looseBatteries)).toBe(false);
  });

  it("marks a claimed standalone row, which gained no row on this scan", () => {
    const wasScanned = scannedRowPredicate({
      ...noNames,
      claimedAssetIds: ["batteries"],
    });
    expect(wasScanned(looseBatteries)).toBe(true);
  });

  it("names an INDIVIDUAL asset's one row however the scan named the asset", () => {
    const camera = {
      asset: { id: "camera", type: "INDIVIDUAL" as const },
      assetKitId: null,
      sourceKitId: null,
    };
    // A kit scan whose slice for the camera was dropped because the booking
    // already holds it loose still went through the camera's row.
    expect(
      scannedRowPredicate({
        ...noNames,
        kitSlices: [{ assetId: "camera", assetKitId: "ak-cam" }],
      })(camera)
    ).toBe(true);
    expect(scannedRowPredicate(noNames)(camera)).toBe(false);
  });

  it("marks an INDIVIDUAL kit member already on the booking when its kit is scanned again", () => {
    // The kit is already on the booking, so the scan adds no slice and names
    // its members only through the kit id.
    const kitCamera = {
      asset: { id: "camera", type: "INDIVIDUAL" as const },
      assetKitId: "ak-cam",
      sourceKitId: "kit-1",
    };
    expect(
      scannedRowPredicate({ ...noNames, kitIds: ["kit-1"] })(kitCamera)
    ).toBe(true);
    expect(
      scannedRowPredicate({ ...noNames, kitIds: ["kit-2"] })(kitCamera)
    ).toBe(false);
  });
});

describe("readBookingMethodMeta", () => {
  it("reads a recorded method back", () => {
    expect(
      readBookingMethodMeta({ method: "scanned", surface: "phone" })
    ).toEqual({ method: "scanned", surface: "phone" });
  });

  it("reads a meta written before methods existed as nothing", () => {
    expect(readBookingMethodMeta({ quantity: 3 })).toBeNull();
    expect(readBookingMethodMeta(null)).toBeNull();
    expect(readBookingMethodMeta("scanned")).toBeNull();
  });

  it("reads an unknown method as null rather than a guess", () => {
    expect(
      readBookingMethodMeta({ method: "teleported", surface: "web" })
    ).toEqual({ method: null, surface: "web" });
  });
});

describe("describeBookingMethod", () => {
  it.each([
    [{ method: "scanned", surface: "phone" }, "scanned on the phone"],
    [{ method: "selected", surface: "web" }, "selected on the web"],
    [{ method: "quick", surface: "web" }, "in one click on the web"],
    [{ method: "quick", surface: "phone" }, "in one tap on the phone"],
    [{ method: null, surface: "phone" }, "on the phone"],
  ] as const)("%o reads %s", (meta, phrase) => {
    expect(describeBookingMethod(meta)).toBe(phrase);
  });

  it("capitalises for a cell that starts with it", () => {
    expect(
      describeBookingMethodCapitalised({ method: "scanned", surface: "phone" })
    ).toBe("Scanned on the phone");
  });
});

describe("describeBatchMethod and bookingMethodClause", () => {
  it("names both ways when a web scan batch mixed scans and ticks", () => {
    expect(
      describeBatchMethod(scanBatchWithTick, ["ba-kit", "ba-standalone"])
    ).toBe("scanned and selected on the web");
    // A batch of only ticked slices is simply selected.
    expect(describeBatchMethod(scanBatchWithTick, ["ba-standalone"])).toBe(
      "selected on the web"
    );
    // Rows without a slice count as scanned next to a ticked slice.
    expect(
      describeBatchMethod(scanBatchWithTick, [undefined, "ba-standalone"])
    ).toBe("scanned and selected on the web");
  });

  it("is the tail of the activity line, as a parenthetical", () => {
    expect(
      bookingMethodClause({ surface: "phone", method: "scanned" }, ["ba-1"])
    ).toBe(" (scanned on the phone)");
    // The one-click actions carry no slice list and read from the batch alone.
    expect(bookingMethodClause({ surface: "web", method: "quick" })).toBe(
      " (in one click on the web)"
    );
  });

  it("adds nothing to a note written without provenance", () => {
    expect(bookingMethodClause(undefined, ["ba-1"])).toBe("");
  });
});
