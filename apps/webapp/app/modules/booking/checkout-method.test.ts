/**
 * Tests for how a check-in or check-out method is recorded and worded.
 *
 * The method is a claim about what happened at the shelf, so these cases pin
 * the two places it must never be invented: a batch with no provenance writes
 * no method keys, and a stored meta that says nothing readable reads as null.
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
  narrowSelectedAssetIds,
  readBookingMethodMeta,
  resolveBookingMethod,
} from "./checkout-method";

// @vitest-environment node

describe("bookingMethodMeta", () => {
  it("stamps every row with the batch's method and surface", () => {
    expect(
      bookingMethodMeta({ surface: "web", method: "quick" }, "asset-1")
    ).toEqual({ method: "quick", surface: "web" });
  });

  it("records a ticked row of a scan batch as selected", () => {
    const provenance = {
      surface: "web" as const,
      method: "scanned" as const,
      selectedAssetIds: ["asset-2"],
    };
    expect(resolveBookingMethod(provenance, "asset-1")).toBe("scanned");
    expect(resolveBookingMethod(provenance, "asset-2")).toBe("selected");
  });

  it("keeps a null method as null, with the surface still recorded", () => {
    // An older phone bundle declared nothing; the route still knows the phone.
    expect(
      bookingMethodMeta({ surface: "phone", method: null }, "asset-1")
    ).toEqual({ method: null, surface: "phone" });
  });

  it("writes no method keys at all without provenance", () => {
    expect(bookingMethodMeta(undefined, "asset-1")).toEqual({});
  });
});

describe("narrowSelectedAssetIds", () => {
  it("keeps only the ticked rows the batch submits, once each", () => {
    expect(
      narrowSelectedAssetIds(
        ["asset-2", "asset-2", "asset-9"],
        ["asset-1", "asset-2"]
      )
    ).toEqual(["asset-2"]);
  });

  it("is empty without ticked rows", () => {
    expect(narrowSelectedAssetIds(undefined, ["asset-1"])).toEqual([]);
    expect(narrowSelectedAssetIds([], ["asset-1"])).toEqual([]);
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
    const provenance = {
      surface: "web" as const,
      method: "scanned" as const,
      selectedAssetIds: ["asset-2"],
    };
    expect(describeBatchMethod(provenance, ["asset-1", "asset-2"])).toBe(
      "scanned and selected on the web"
    );
    // A batch of only ticked rows is simply selected.
    expect(describeBatchMethod(provenance, ["asset-2"])).toBe(
      "selected on the web"
    );
  });

  it("is the tail of the activity line, as a parenthetical", () => {
    expect(
      bookingMethodClause({ surface: "phone", method: "scanned" }, ["asset-1"])
    ).toBe(" (scanned on the phone)");
    // The one-click actions carry no row list and read from the batch alone.
    expect(bookingMethodClause({ surface: "web", method: "quick" })).toBe(
      " (in one click on the web)"
    );
  });

  it("adds nothing to a note written without provenance", () => {
    expect(bookingMethodClause(undefined, ["asset-1"])).toBe("");
  });
});
