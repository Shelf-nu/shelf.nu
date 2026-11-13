/**
 * Tests for {@link resolveUntaggedDisposition}. Pure: no mocks.
 *
 * @see {@link file://./untagged-resolution.ts}
 */
import type { SourceRowState } from "@shelf/quantity-control";
import { describe, expect, it } from "vitest";

import type { SourceAllocationMode } from "./types";
import { resolveUntaggedDisposition } from "./untagged-resolution";

/** Builds a LOCATION row with `out` units out. */
function row(id: string, out: number): SourceRowState & { id: string } {
  return {
    id,
    kind: "LOCATION",
    locationId: `loc-${id}`,
    quantity: out,
    outQuantity: out,
    releasedQuantity: 0,
    dispatchedTotal: out,
    sharedQuantity: 0,
  };
}

/** Builds a slice with the given rows. */
function slice(
  id: string,
  allocationOrder: number,
  rows: Array<SourceRowState & { id: string }>,
  mode: SourceAllocationMode = "AUTO"
) {
  return { id, mode, allocationOrder, rows };
}

describe("resolveUntaggedDisposition", () => {
  it("takes the most out first across slices", () => {
    const shares = resolveUntaggedDisposition({
      slices: [slice("s2", 2, [row("r2", 3)]), slice("s1", 1, [row("r1", 5)])],
      units: 8,
    });
    expect(shares).toEqual([
      { sliceId: "s1", sourceRowId: "r1", units: 5 },
      { sliceId: "s2", sourceRowId: "r2", units: 3 },
    ]);
  });

  it("takes only what is needed from the last row", () => {
    const shares = resolveUntaggedDisposition({
      slices: [slice("s1", 1, [row("r1", 5)]), slice("s2", 2, [row("r2", 3)])],
      units: 6,
    });
    expect(shares).toEqual([
      { sliceId: "s1", sourceRowId: "r1", units: 5 },
      { sliceId: "s2", sourceRowId: "r2", units: 1 },
    ]);
  });

  it("breaks ties by allocation order", () => {
    const shares = resolveUntaggedDisposition({
      slices: [
        slice("late", 2, [row("a", 4)]),
        slice("early", 1, [row("b", 4)]),
      ],
      units: 4,
    });
    expect(shares).toEqual([{ sliceId: "early", sourceRowId: "b", units: 4 }]);
  });

  it("skips rows with nothing out and UNASSIGNED rows", () => {
    const unassigned: SourceRowState & { id: string } = {
      id: "u",
      kind: "UNASSIGNED",
      locationId: null,
      quantity: 2,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    };
    const shares = resolveUntaggedDisposition({
      slices: [slice("s1", 1, [unassigned, row("idle", 0), row("r", 2)])],
      units: 2,
    });
    expect(shares).toEqual([{ sliceId: "s1", sourceRowId: "r", units: 2 }]);
  });

  it("throws when units exceed the total out", () => {
    expect(() =>
      resolveUntaggedDisposition({
        slices: [slice("s1", 1, [row("r1", 2)])],
        units: 3,
      })
    ).toThrow();
  });

  it("throws when a LEGACY slice is passed", () => {
    expect(() =>
      resolveUntaggedDisposition({
        slices: [slice("s1", 1, [row("r1", 2)], "LEGACY")],
        units: 1,
      })
    ).toThrow();
  });
});
