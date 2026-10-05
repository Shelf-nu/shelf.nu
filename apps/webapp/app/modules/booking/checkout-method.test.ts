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
  readBookingMethodMeta,
  resolveBookingMethod,
  resolveBookingMethodForSlices,
  webFormMethodSchema,
  webFormProvenance,
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

describe("webFormMethodSchema and webFormProvenance", () => {
  it("records the header's one-click post, which declares nothing, as quick", () => {
    const { method } = webFormMethodSchema.parse({});
    expect(webFormProvenance(method)).toEqual({
      surface: "web",
      method: "quick",
    });
  });

  it("records the list dialog's post, which declares selected, as selected", () => {
    const { method } = webFormMethodSchema.parse({ method: "selected" });
    expect(webFormProvenance(method)).toEqual({
      surface: "web",
      method: "selected",
    });
  });

  it("refuses a form that claims a method the overview cannot produce", () => {
    // Nothing scans on the overview, and quick is the route's own assertion.
    expect(webFormMethodSchema.safeParse({ method: "scanned" }).success).toBe(
      false
    );
    expect(webFormMethodSchema.safeParse({ method: "quick" }).success).toBe(
      false
    );
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
