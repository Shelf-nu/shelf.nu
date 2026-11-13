/**
 * Tests for {@link resizeKitRow}. Pure: no mocks.
 *
 * @see {@link file://./kit-quantity.ts}
 */
import type { SourceRowState } from "@shelf/quantity-control";
import { describe, expect, it } from "vitest";

import { resizeKitRow } from "./kit-quantity";

/** Kit row for a slice with Q 5, D 10, S 10: out 0, released 5. */
const kitRow: SourceRowState = {
  kind: "KIT",
  locationId: null,
  quantity: 5,
  outQuantity: 0,
  releasedQuantity: 5,
  dispatchedTotal: 10,
  sharedQuantity: 10,
};

describe("resizeKitRow", () => {
  it("adds one pending unit when raised from 5 to 6", () => {
    const result = resizeKitRow(kitRow, 6);
    expect(result).toEqual({ ok: true, row: { ...kitRow, quantity: 6 } });
  });

  it("removes the pending unit when lowered back to 5", () => {
    const raised = resizeKitRow(kitRow, 6);
    if (!raised.ok) throw new Error("expected ok");
    const lowered = resizeKitRow(raised.row, 5);
    expect(lowered).toEqual({ ok: true, row: kitRow });
  });

  it("takes released units once pending is gone", () => {
    const result = resizeKitRow(kitRow, 3);
    expect(result).toEqual({
      ok: true,
      row: { ...kitRow, quantity: 3, releasedQuantity: 3 },
    });
  });

  it("refuses to go below the units out and reports them", () => {
    const out: SourceRowState = {
      ...kitRow,
      quantity: 5,
      outQuantity: 4,
      releasedQuantity: 1,
      dispatchedTotal: 4,
      sharedQuantity: 0,
    };
    expect(resizeKitRow(out, 3)).toEqual({ ok: false, out: 4 });
    expect(resizeKitRow(out, 4)).toEqual({
      ok: true,
      row: { ...out, quantity: 4, releasedQuantity: 0 },
    });
  });

  it("throws for a row that is not a KIT row", () => {
    expect(() => resizeKitRow({ ...kitRow, kind: "UNPLACED" }, 6)).toThrow();
  });
});
