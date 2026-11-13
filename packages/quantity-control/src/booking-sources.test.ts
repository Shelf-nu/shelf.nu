/**
 * Tests for the booking source row model: derived counters, kind rules,
 * reconciliation, and every transition (dispatch, settle, moves, decrease).
 *
 * @see ./booking-sources.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decreaseSliceQuantity,
  dispatchFromRow,
  historyOf,
  isRowRemovable,
  KNOWN_KINDS,
  moveHistory,
  partialMoveOut,
  pendingOf,
  remainingReservationOf,
  settleOnRow,
  sourceKey,
  sourceRowViolations,
  type SourceRowState,
} from "./booking-sources";

/** Builds a row, defaulting every counter to 0 and the kind to LOCATION "A". */
function row(over: Partial<SourceRowState> = {}): SourceRowState {
  const kind = over.kind ?? "LOCATION";
  return {
    kind,
    locationId: kind === "LOCATION" ? "A" : null,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
    sharedQuantity: 0,
    ...over,
  };
}

test("known kinds and source keys", () => {
  assert.deepEqual([...KNOWN_KINDS], ["LOCATION", "UNPLACED", "KIT"]);
  assert.equal(sourceKey({ kind: "LOCATION", locationId: "A" }), "LOCATION:A");
  assert.equal(sourceKey({ kind: "UNPLACED", locationId: null }), "UNPLACED:");
});

test("pending and remaining reservation", () => {
  const r = row({
    quantity: 10,
    outQuantity: 4,
    releasedQuantity: 3,
    dispatchedTotal: 7,
    sharedQuantity: 3,
  });
  assert.equal(pendingOf(r), 3);
  assert.equal(remainingReservationOf(r), 7);
  assert.equal(historyOf(r), 3);
});

test("UNKNOWN requires quantity = out and released 0, allows history", () => {
  assert.deepEqual(
    sourceRowViolations(
      row({
        kind: "UNKNOWN",
        quantity: 0,
        outQuantity: 0,
        dispatchedTotal: 10,
        sharedQuantity: 10,
      })
    ),
    []
  );
  assert.ok(
    sourceRowViolations(row({ kind: "UNKNOWN", quantity: 5, outQuantity: 0 }))
      .length > 0
  );
  assert.ok(
    sourceRowViolations(
      row({
        kind: "UNKNOWN",
        quantity: 2,
        outQuantity: 2,
        releasedQuantity: 1,
        dispatchedTotal: 2,
      })
    ).length > 0
  );
});

test("UNASSIGNED never out, no history, no shares", () => {
  assert.deepEqual(
    sourceRowViolations(row({ kind: "UNASSIGNED", quantity: 3 })),
    []
  );
  assert.ok(
    sourceRowViolations(
      row({
        kind: "UNASSIGNED",
        quantity: 3,
        outQuantity: 1,
        dispatchedTotal: 1,
      })
    ).length > 0
  );
  assert.ok(
    sourceRowViolations(
      row({
        kind: "UNASSIGNED",
        quantity: 3,
        dispatchedTotal: 2,
        sharedQuantity: 2,
      })
    ).length > 0
  );
});

test("violations: counters, bounds and locationId rule", () => {
  assert.ok(sourceRowViolations(row({ quantity: -1 })).length > 0);
  assert.ok(sourceRowViolations(row({ quantity: 1.5 })).length > 0);
  assert.ok(
    sourceRowViolations(
      row({
        quantity: 5,
        outQuantity: 3,
        releasedQuantity: 3,
        dispatchedTotal: 3,
      })
    ).length > 0
  );
  assert.ok(
    sourceRowViolations(row({ kind: "LOCATION", locationId: null })).length > 0
  );
  assert.ok(
    sourceRowViolations(row({ kind: "UNPLACED", locationId: "A" })).length > 0
  );
  assert.deepEqual(sourceRowViolations(row({ kind: "UNPLACED" })), []);
});

test("reconciliation: dispatchedTotal - shared = out", () => {
  assert.deepEqual(
    sourceRowViolations(
      row({
        quantity: 5,
        outQuantity: 2,
        dispatchedTotal: 5,
        sharedQuantity: 3,
      })
    ),
    []
  );
  assert.ok(
    sourceRowViolations(
      row({
        quantity: 5,
        outQuantity: 2,
        dispatchedTotal: 5,
        sharedQuantity: 2,
      })
    ).length > 0
  );
});

test("dispatch within pending raises out and dispatchedTotal", () => {
  const { row: r, reclaimed } = dispatchFromRow(row({ quantity: 10 }), 4);
  assert.equal(r.outQuantity, 4);
  assert.equal(r.dispatchedTotal, 4);
  assert.equal(r.releasedQuantity, 0);
  assert.equal(reclaimed, 0);
});

test("dispatch beyond pending reclaims released", () => {
  const { row: r, reclaimed } = dispatchFromRow(
    row({ quantity: 5, releasedQuantity: 5 }),
    2
  );
  assert.equal(r.releasedQuantity, 3);
  assert.equal(r.outQuantity, 2);
  assert.equal(r.dispatchedTotal, 2);
  assert.equal(reclaimed, 2);
});

test("dispatch refuses unknown kinds, bad k and over-dispatch", () => {
  assert.throws(() => dispatchFromRow(row({ kind: "UNKNOWN" }), 1));
  assert.throws(() =>
    dispatchFromRow(row({ kind: "UNASSIGNED", quantity: 2 }), 1)
  );
  assert.throws(() => dispatchFromRow(row({ quantity: 2 }), 0));
  assert.throws(() => dispatchFromRow(row({ quantity: 2 }), 3));
  assert.deepEqual(
    dispatchFromRow(row({ kind: "KIT", quantity: 2 }), 2).row.outQuantity,
    2
  );
});

test("settle on a known row moves out to released and records a share", () => {
  const { row: r, toUnassigned } = settleOnRow(
    row({ quantity: 5, outQuantity: 5, dispatchedTotal: 5 }),
    3
  );
  assert.deepEqual(
    [r.outQuantity, r.releasedQuantity, r.sharedQuantity, r.quantity],
    [2, 3, 3, 5]
  );
  assert.equal(toUnassigned, null);
  assert.deepEqual(sourceRowViolations(r), []);
});

test("settle from UNKNOWN moves quantity and released to UNASSIGNED", () => {
  const { row: u, toUnassigned } = settleOnRow(
    row({ kind: "UNKNOWN", quantity: 4, outQuantity: 4, dispatchedTotal: 4 }),
    3
  );
  assert.deepEqual(
    [u.quantity, u.outQuantity, u.sharedQuantity, u.dispatchedTotal],
    [1, 1, 3, 4]
  );
  assert.deepEqual(toUnassigned, { quantity: 3, released: 3 });
  assert.deepEqual(sourceRowViolations(u), []);
});

test("settle refuses UNASSIGNED, k beyond out and k <= 0", () => {
  assert.throws(() => settleOnRow(row({ kind: "UNASSIGNED", quantity: 2 }), 1));
  assert.throws(() =>
    settleOnRow(row({ quantity: 5, outQuantity: 1, dispatchedTotal: 1 }), 2)
  );
  assert.throws(() => settleOnRow(row({ quantity: 5 }), 0));
});

test("partial move keeps both invariants", () => {
  const origin = row({
    quantity: 6,
    outQuantity: 4,
    releasedQuantity: 1,
    dispatchedTotal: 5,
    sharedQuantity: 1,
  });
  const dest = row({ kind: "UNPLACED", quantity: 2 });
  const moved = partialMoveOut(origin, dest, 3);
  assert.deepEqual(
    [
      moved.origin.quantity,
      moved.origin.outQuantity,
      moved.origin.dispatchedTotal,
      moved.origin.sharedQuantity,
    ],
    [3, 1, 2, 1]
  );
  assert.deepEqual(
    [moved.dest.quantity, moved.dest.outQuantity, moved.dest.dispatchedTotal],
    [5, 3, 3]
  );
  assert.deepEqual(sourceRowViolations(moved.origin), []);
  assert.deepEqual(sourceRowViolations(moved.dest), []);
  assert.throws(() => partialMoveOut(origin, dest, 5));
  assert.throws(() => partialMoveOut(origin, row({ kind: "UNASSIGNED" }), 1));
});

test("history move carries dispatchedTotal - out and shares", () => {
  const origin = row({
    quantity: 5,
    outQuantity: 2,
    releasedQuantity: 3,
    dispatchedTotal: 5,
    sharedQuantity: 3,
  });
  const dest = row({ kind: "UNPLACED", quantity: 1 });
  const moved = moveHistory(origin, dest);
  assert.deepEqual(
    [moved.origin.dispatchedTotal, moved.origin.sharedQuantity],
    [2, 0]
  );
  assert.deepEqual(
    [moved.dest.dispatchedTotal, moved.dest.sharedQuantity],
    [3, 3]
  );
  assert.deepEqual(sourceRowViolations(moved.origin), []);
  assert.deepEqual(sourceRowViolations(moved.dest), []);
});

test("decrease takes UNASSIGNED pending, then smallest known pending, then released, never below out", () => {
  const rows = [
    row({ quantity: 6, outQuantity: 1, dispatchedTotal: 1 }), // A pending 5
    row({ kind: "UNPLACED", quantity: 3, releasedQuantity: 1 }), // pending 2, released 1
    row({ kind: "UNASSIGNED", quantity: 2 }), // pending 2
  ];
  // d=3: UNASSIGNED 2, then UNPLACED pending 1.
  let out = decreaseSliceQuantity(rows, 3);
  assert.deepEqual(
    out.map((r) => r.quantity),
    [6, 2, 0]
  );
  // d=5: UNASSIGNED 2, UNPLACED pending 2, then A pending 1.
  out = decreaseSliceQuantity(rows, 5);
  assert.deepEqual(
    out.map((r) => r.quantity),
    [5, 1, 0]
  );
  // d=8: all pending (2+2+5 = 9) minus one: A pending 4.
  out = decreaseSliceQuantity(rows, 8);
  assert.deepEqual(
    out.map((r) => r.quantity),
    [2, 1, 0]
  );
  // d=10: all pending 9, then released 1 from UNPLACED.
  out = decreaseSliceQuantity(rows, 10);
  assert.deepEqual(
    out.map((r) => [r.quantity, r.releasedQuantity]),
    [
      [1, 0],
      [0, 0],
      [0, 0],
    ]
  );
  // never below out: removable is 10, so 11 throws.
  assert.throws(() => decreaseSliceQuantity(rows, 11));
  // input untouched
  assert.equal(rows[0].quantity, 6);
});

test("decrease keeps removable rows in the array", () => {
  const out = decreaseSliceQuantity([row({ quantity: 2 })], 2);
  assert.equal(out.length, 1);
  assert.equal(isRowRemovable(out[0]), true);
});

test("isRowRemovable false while history remains", () => {
  assert.equal(isRowRemovable(row()), true);
  assert.equal(
    isRowRemovable(
      row({ kind: "UNKNOWN", dispatchedTotal: 10, sharedQuantity: 10 })
    ),
    false
  );
  assert.equal(isRowRemovable(row({ quantity: 1 })), false);
});
