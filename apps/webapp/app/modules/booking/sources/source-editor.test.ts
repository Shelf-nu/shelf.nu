/**
 * Tests for the source editor model: the pending total the split must reach
 * and the MANUAL request built from the typed split.
 *
 * @see {@link file://./source-editor.ts}
 */

import { describe, expect, it } from "vitest";

import {
  initialSplitValues,
  isSplitLocked,
  pendingTotal,
  requiredPending,
  resolveManualSources,
  type SourceEditorData,
} from "./source-editor";
import { bookingSourcesInputSchema } from "./sources-input";

/** A never-dispatched slice of 15: 8 at the warehouse, 7 unplaced. */
function reservedEditor(
  overrides: Partial<SourceEditorData> = {}
): SourceEditorData {
  return {
    sliceId: "ba-1",
    mode: "AUTO",
    rows: [
      {
        key: "LOCATION:loc-1",
        locationId: "loc-1",
        label: "Demo Warehouse",
        pending: 8,
        out: 0,
        free: 10,
      },
      {
        key: "UNPLACED:",
        locationId: null,
        label: "Unplaced",
        pending: 7,
        out: 0,
        free: 9,
      },
    ],
    unassignedPending: 0,
    unknownOut: 0,
    stranded: [],
    ...overrides,
  };
}

describe("pendingTotal / requiredPending", () => {
  it("counts units waiting on Needs a location", () => {
    const editor = reservedEditor({ unassignedPending: 3 });
    expect(pendingTotal(editor)).toBe(18);
  });

  it("follows a quantity change", () => {
    expect(requiredPending(reservedEditor(), 2)).toBe(17);
    expect(requiredPending(reservedEditor(), -5)).toBe(10);
  });
});

describe("isSplitLocked", () => {
  it("locks the split while units sit at a former placement", () => {
    expect(isSplitLocked(reservedEditor())).toBe(false);
    expect(
      isSplitLocked(
        reservedEditor({
          stranded: [
            {
              key: "LOCATION:loc-gone",
              locationId: "loc-gone",
              label: "Old Shed",
              pending: 0,
              out: 2,
            },
          ],
        })
      )
    ).toBe(true);
  });
});

describe("initialSplitValues", () => {
  it("starts each input at the source's pending units", () => {
    expect(initialSplitValues(reservedEditor())).toEqual({
      "LOCATION:loc-1": "8",
      "UNPLACED:": "7",
    });
  });
});

describe("resolveManualSources", () => {
  it("builds a MANUAL request the schema accepts", () => {
    const result = resolveManualSources({
      editor: reservedEditor(),
      values: { "LOCATION:loc-1": "15", "UNPLACED:": "0" },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: true,
      input: {
        mode: "MANUAL",
        sources: [{ locationId: "loc-1", quantity: 15 }],
      },
    });
    if (result.ok) {
      expect(bookingSourcesInputSchema.safeParse(result.input).success).toBe(
        true
      );
    }
  });

  it("refuses a split that does not add up to the quantity", () => {
    const result = resolveManualSources({
      editor: reservedEditor(),
      values: { "LOCATION:loc-1": "5", "UNPLACED:": "5" },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: false,
      message: "The sources must add up to 15 units.",
    });
  });

  it("measures the split against the new quantity", () => {
    const result = resolveManualSources({
      editor: reservedEditor(),
      values: { "LOCATION:loc-1": "10", "UNPLACED:": "10" },
      quantityDelta: 5,
      unitLabel: "pcs",
    });

    expect(result.ok).toBe(true);
  });

  it("refuses fractions and negative numbers", () => {
    for (const bad of ["1.5", "-1", "abc"]) {
      const result = resolveManualSources({
        editor: reservedEditor(),
        values: { "LOCATION:loc-1": bad, "UNPLACED:": "7" },
        quantityDelta: 0,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a blank input instead of reading it as 0", () => {
    const result = resolveManualSources({
      editor: reservedEditor(),
      values: { "LOCATION:loc-1": "15", "UNPLACED:": "  " },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: false,
      message: "Enter units for every source, 0 for none.",
    });
  });

  it("sends planned units (out plus pending) once units are out", () => {
    // ONGOING: 2 out from the warehouse, 6 pending there, 7 pending unplaced.
    const editor = reservedEditor({
      rows: [
        {
          key: "LOCATION:loc-1",
          locationId: "loc-1",
          label: "Demo Warehouse",
          pending: 6,
          out: 2,
          free: 10,
        },
        {
          key: "UNPLACED:",
          locationId: null,
          label: "Unplaced",
          pending: 7,
          out: 0,
          free: 9,
        },
      ],
    });

    const result = resolveManualSources({
      editor,
      values: { "LOCATION:loc-1": "0", "UNPLACED:": "13" },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: true,
      input: {
        mode: "MANUAL",
        sources: [
          { locationId: "loc-1", quantity: 2 },
          { locationId: null, quantity: 13 },
        ],
      },
    });
  });

  it("names the units still to go out when some are out", () => {
    const editor = reservedEditor({ unknownOut: 1 });
    const result = resolveManualSources({
      editor,
      values: { "LOCATION:loc-1": "1", "UNPLACED:": "1" },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: false,
      message: "The units still to go out must add up to 15.",
    });
  });

  it("asks for units waiting on Needs a location to be placed", () => {
    const editor = reservedEditor({ unassignedPending: 3 });
    const kept = resolveManualSources({
      editor,
      values: initialSplitValues(editor),
      quantityDelta: 0,
    });
    expect(kept.ok).toBe(false);

    const placed = resolveManualSources({
      editor,
      values: { "LOCATION:loc-1": "11", "UNPLACED:": "7" },
      quantityDelta: 0,
    });
    expect(placed.ok).toBe(true);
  });

  it("still sends one entry when nothing is left to place", () => {
    const editor = reservedEditor({
      rows: [
        {
          key: "LOCATION:loc-1",
          locationId: "loc-1",
          label: "Demo Warehouse",
          pending: 0,
          out: 0,
          free: 10,
        },
      ],
    });
    const result = resolveManualSources({
      editor,
      values: { "LOCATION:loc-1": "0" },
      quantityDelta: 0,
    });

    expect(result).toEqual({
      ok: true,
      input: {
        mode: "MANUAL",
        sources: [{ locationId: "loc-1", quantity: 0 }],
      },
    });
  });
});
