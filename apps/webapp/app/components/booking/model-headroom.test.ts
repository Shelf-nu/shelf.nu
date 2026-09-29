/**
 * Tests for the picker's per-model selection cap.
 *
 * The server measures a whole batch of named units against the pool at once,
 * so the page has to say "no more of this model" as the selection grows.
 * Getting this wrong is invisible until Confirm: the rows look selectable and
 * the write returns a 400 naming a limit the page never showed.
 *
 * @see {@link file://./model-headroom.ts}
 */
import { describe, expect, it } from "vitest";

import { assetIdsBlockedByModelHeadroom } from "./model-headroom";

/** Every asset the picker has rendered so far, across pages and searches. */
const MODEL_BY_ASSET_ID = new Map([
  ["a1", "m1"],
  ["a2", "m1"],
  ["a3", "m1"],
  ["b1", "m2"],
]);

const allRows = ["a1", "a2", "a3", "b1", "loose"].map((id) => ({ id }));

function blocked({
  rows = allRows,
  selected = [] as string[],
  onBooking = [] as string[],
  headroom = {} as Record<string, number>,
}) {
  return [
    ...assetIdsBlockedByModelHeadroom({
      rows,
      modelIdByAssetId: MODEL_BY_ASSET_ID,
      selectedAssetIds: new Set(selected),
      alreadyOnBookingIds: new Set(onBooking),
      modelHeadroom: headroom,
    }),
  ].sort();
}

describe("assetIdsBlockedByModelHeadroom", () => {
  it("blocks nothing while the model has room", () => {
    expect(blocked({ selected: ["a1"], headroom: { m1: 2 } })).toEqual([]);
  });

  it("blocks the model's remaining rows once the selection fills its room", () => {
    expect(blocked({ selected: ["a1"], headroom: { m1: 1 } })).toEqual([
      "a2",
      "a3",
    ]);
  });

  it("never blocks a row that is itself selected", () => {
    // Otherwise reaching the limit would also take away the only way back
    // under it.
    expect(blocked({ selected: ["a1", "a2"], headroom: { m1: 1 } })).toEqual([
      "a3",
    ]);
  });

  it("does not let a unit already on the booking consume room", () => {
    // The server counts it on the booking's side of the pool, not as an
    // addition, and the headroom it shipped already accounts for it.
    expect(
      blocked({ selected: ["a1"], onBooking: ["a1"], headroom: { m1: 1 } })
    ).toEqual([]);
  });

  it("never blocks a unit already on the booking", () => {
    expect(
      blocked({ selected: ["a2"], onBooking: ["a1"], headroom: { m1: 1 } })
    ).toEqual(["a3"]);
  });

  it("judges each model on its own selection", () => {
    expect(
      blocked({ selected: ["a1", "b1"], headroom: { m1: 1, m2: 2 } })
    ).toEqual(["a2", "a3"]);
  });

  it("says nothing about a model with no limit, or a unit with no model", () => {
    expect(blocked({ selected: ["a1", "a2", "a3"], headroom: {} })).toEqual([]);
    expect(blocked({ selected: ["a1"], headroom: { m1: 1 } })).not.toContain(
      "loose"
    );
  });

  it("blocks the whole model when it has no room at all", () => {
    expect(blocked({ headroom: { m1: 0 } })).toEqual(["a1", "a2", "a3"]);
  });

  it("counts a unit selected on a page that is no longer on screen", () => {
    // Selection survives paging and searching, so a unit of this model can be
    // holding one of its slots from a page the picker is not showing. Judging
    // only the visible rows would re-enable a model the user already filled.
    expect(
      blocked({
        rows: [{ id: "a2" }, { id: "a3" }],
        selected: ["a1"],
        headroom: { m1: 1 },
      })
    ).toEqual(["a2", "a3"]);
  });

  it("ignores an off-screen selection the booking already holds", () => {
    expect(
      blocked({
        rows: [{ id: "a2" }, { id: "a3" }],
        selected: ["a1"],
        onBooking: ["a1"],
        headroom: { m1: 1 },
      })
    ).toEqual([]);
  });

  it("ignores a selected id it has never seen a model for", () => {
    // A row the picker has not rendered cannot be selected — select-all is
    // disabled on this list — so an unresolvable id is not a unit to count.
    expect(blocked({ selected: ["ghost"], headroom: { m1: 1 } })).toEqual([]);
  });
});
