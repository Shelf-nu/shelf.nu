/**
 * Tests for the sources request schema of the adjust-quantity action: the
 * shape bounds it enforces (the state-dependent checks live in the facade).
 *
 * @see {@link file://./sources-input.ts}
 */

import { describe, expect, it } from "vitest";

import {
  bookingSourcesInputSchema,
  MAX_SOURCES_INPUT,
  sourcesFormFieldSchema,
} from "./sources-input";

// @vitest-environment node

/** A MANUAL request with the given entries. */
function manual(
  sources: Array<{ locationId: string | null; quantity: number }>
) {
  return { mode: "MANUAL", sources };
}

describe("bookingSourcesInputSchema", () => {
  it("accepts AUTO", () => {
    expect(bookingSourcesInputSchema.parse({ mode: "AUTO" })).toEqual({
      mode: "AUTO",
    });
  });

  it("accepts a split over locations and Unplaced", () => {
    const input = manual([
      { locationId: "loc-1", quantity: 8 },
      { locationId: null, quantity: 7 },
    ]);
    expect(bookingSourcesInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a source with 0 units", () => {
    expect(
      bookingSourcesInputSchema.safeParse(
        manual([{ locationId: "loc-1", quantity: 0 }])
      ).success
    ).toBe(true);
  });

  it.each([
    ["a negative quantity", -1],
    ["a fraction", 1.5],
    ["a string", "3"],
  ])("refuses %s", (_label, quantity) => {
    expect(
      bookingSourcesInputSchema.safeParse({
        mode: "MANUAL",
        sources: [{ locationId: "loc-1", quantity }],
      }).success
    ).toBe(false);
  });

  it("refuses the same location twice", () => {
    expect(
      bookingSourcesInputSchema.safeParse(
        manual([
          { locationId: "loc-1", quantity: 1 },
          { locationId: "loc-1", quantity: 2 },
        ])
      ).success
    ).toBe(false);
  });

  it("refuses Unplaced twice", () => {
    expect(
      bookingSourcesInputSchema.safeParse(
        manual([
          { locationId: null, quantity: 1 },
          { locationId: null, quantity: 2 },
        ])
      ).success
    ).toBe(false);
  });

  it("refuses an empty list", () => {
    expect(bookingSourcesInputSchema.safeParse(manual([])).success).toBe(false);
  });

  it("caps the list length", () => {
    const at = Array.from({ length: MAX_SOURCES_INPUT }, (_, i) => ({
      locationId: `loc-${i}`,
      quantity: 1,
    }));
    expect(bookingSourcesInputSchema.safeParse(manual(at)).success).toBe(true);
    expect(
      bookingSourcesInputSchema.safeParse(
        manual([...at, { locationId: "loc-extra", quantity: 1 }])
      ).success
    ).toBe(false);
  });

  it("refuses an empty location id and an unknown mode", () => {
    expect(
      bookingSourcesInputSchema.safeParse(
        manual([{ locationId: "", quantity: 1 }])
      ).success
    ).toBe(false);
    expect(bookingSourcesInputSchema.safeParse({ mode: "KIT" }).success).toBe(
      false
    );
  });
});

describe("sourcesFormFieldSchema", () => {
  it("reads a missing or blank field as no change", () => {
    expect(sourcesFormFieldSchema.parse(undefined)).toBeUndefined();
    expect(sourcesFormFieldSchema.parse("   ")).toBeUndefined();
  });

  it("parses JSON text", () => {
    expect(
      sourcesFormFieldSchema.parse(
        JSON.stringify(manual([{ locationId: null, quantity: 3 }]))
      )
    ).toEqual(manual([{ locationId: null, quantity: 3 }]));
  });

  it("refuses text that is not JSON or not a valid request", () => {
    expect(sourcesFormFieldSchema.safeParse("{not json").success).toBe(false);
    expect(
      sourcesFormFieldSchema.safeParse(JSON.stringify({ mode: "MANUAL" }))
        .success
    ).toBe(false);
  });
});
