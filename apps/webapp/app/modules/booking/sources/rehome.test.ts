/**
 * Tests for the booking source rehome and location delete planners.
 *
 * Pure: no mocks. Pins that custody moves exactly as `planCustodyRehome` when
 * no booking units are out, that booking out units move first from the same
 * excess (latest dispatched first), the destination rule (single destination
 * with room, else Unplaced when it really covers, else Unknown), and how
 * location delete splits every row at a deleted location into its parts.
 *
 * @see {@link file://./rehome.ts}
 * @see {@link file://../../asset/custody-source.ts}
 */
import { describe, expect, it } from "vitest";

import type {
  CustodyRowForPlan,
  CustodySourceState,
} from "~/modules/asset/custody-source";
import { planCustodyRehome } from "~/modules/asset/custody-source";

import type { BookingOutRow, EvacuationRow } from "./rehome";
import {
  aggregateEvacuationTargets,
  planLocationDeleteEvacuation,
  planSourceRehome,
} from "./rehome";

const A = "loc-a";
const B = "loc-b";
const C = "loc-c";

/** `sourceKey` of a LOCATION source. */
const loc = (id: string) => `LOCATION:${id}`;

/** A pool with manual placements given as `[locationId, quantity]`. */
function state(
  total: number,
  placements: Array<[string, number]>
): CustodySourceState {
  return {
    total,
    placements: placements.map(([locationId, quantity]) => ({
      locationId,
      quantity,
    })),
    operatorCustody: [],
  };
}

/** An operator custody row. */
function custody(
  id: string,
  locationId: string | null,
  quantity: number,
  teamMemberId = "tm-1",
  sourceUnknown = false
): CustodyRowForPlan {
  return {
    id,
    teamMemberId,
    locationId,
    sourceUnknown,
    quantity,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

/** A booking source row with units out. */
function out(
  sourceRowId: string,
  sliceId: string,
  key: string,
  units: number,
  checkedOutAt = "2026-09-01T00:00:00.000Z"
): BookingOutRow {
  return {
    sourceRowId,
    sliceId,
    sliceCheckedOutAt: new Date(checkedOutAt),
    key,
    out: units,
  };
}

/** A source row as the delete planner reads it. */
function sourceRow(
  overrides: Partial<EvacuationRow> & Pick<EvacuationRow, "id" | "sliceId">
): EvacuationRow {
  return {
    kind: "LOCATION",
    locationId: A,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
    sharedQuantity: 0,
    mode: "AUTO",
    sliceCheckedOutAt: null,
    ...overrides,
  };
}

describe("planSourceRehome: custody-only parity", () => {
  const cases: Array<{
    name: string;
    before: CustodySourceState;
    after: CustodySourceState;
    rows: CustodyRowForPlan[];
    destinationLocationId?: string | null;
  }> = [
    {
      name: "single destination, splitting a row",
      before: state(8, [
        [A, 4],
        [B, 4],
      ]),
      after: state(8, [
        [A, 1],
        [B, 7],
      ]),
      rows: [custody("r1", A, 3)],
      destinationLocationId: B,
    },
    {
      name: "whole-pool move takes unplaced custody along",
      before: state(10, [
        [A, 4],
        [B, 4],
      ]),
      after: state(10, [[C, 10]]),
      rows: [
        custody("r1", A, 3),
        custody("r2", B, 2, "tm-2"),
        custody("r3", null, 1),
      ],
      destinationLocationId: C,
    },
    {
      name: "shrink with no destination",
      before: state(4, [
        [A, 2],
        [B, 2],
      ]),
      after: state(4, [
        [A, 2],
        [B, 1],
      ]),
      rows: [custody("r1", B, 2)],
    },
    {
      name: "destination fits only part",
      before: state(10, [
        [A, 4],
        [B, 4],
      ]),
      after: state(10, [[C, 2]]),
      rows: [custody("r1", A, 3)],
      destinationLocationId: C,
    },
    {
      name: "unplaced custody follows one destination",
      before: state(10, []),
      after: state(10, [[A, 8]]),
      rows: [custody("r1", null, 6)],
      destinationLocationId: A,
    },
    {
      name: "several destinations leave unplaced custody untouched",
      before: state(10, []),
      after: state(10, [
        [A, 6],
        [B, 4],
      ]),
      rows: [custody("r1", null, 4)],
    },
    {
      name: "pre-existing drift is preserved",
      before: state(6, [
        [A, 2],
        [B, 2],
      ]),
      after: state(6, [
        [A, 2],
        [B, 4],
      ]),
      rows: [custody("r1", A, 3)],
    },
    {
      name: "custody with an unrecorded source never moves",
      before: state(10, [
        [A, 4],
        [B, 4],
      ]),
      after: state(10, [[C, 10]]),
      rows: [
        custody("r-unplaced", null, 1),
        custody("r-unknown", null, 2, "tm-1", true),
      ],
      destinationLocationId: C,
    },
  ];

  it.each(cases)(
    "$name: same custody moves as planCustodyRehome",
    ({ before, after, rows, destinationLocationId }) => {
      const expected = planCustodyRehome({
        before,
        after,
        rows,
        destinationLocationId,
      });
      expect(
        planSourceRehome({
          before,
          after,
          bookingOutRows: [],
          custodyRows: rows,
          destinationLocationId,
        })
      ).toEqual({ bookingMoves: [], custodyMoves: expected });
    }
  );
});

describe("planSourceRehome: booking out units", () => {
  it("moves nothing when 2 of 10 out at A are lost (post-operation state)", () => {
    expect(
      planSourceRehome({
        before: state(10, [[A, 10]]),
        after: state(8, [[A, 8]]),
        bookingOutRows: [out("bo1", "s1", loc(A), 8)],
        custodyRows: [],
      })
    ).toEqual({ bookingMoves: [], custodyMoves: [] });
  });

  it("preserves pre-existing drift", () => {
    // A held 2 with 3 out before; growing B creates no excess at A.
    expect(
      planSourceRehome({
        before: state(6, [
          [A, 2],
          [B, 2],
        ]),
        after: state(6, [
          [A, 2],
          [B, 4],
        ]),
        bookingOutRows: [out("bo1", "s1", loc(A), 3)],
        custodyRows: [],
      })
    ).toEqual({ bookingMoves: [], custodyMoves: [] });

    // A held 4 with 5 out (drift 1); moving 2 away moves only the 2 created.
    expect(
      planSourceRehome({
        before: state(10, [
          [A, 4],
          [B, 6],
        ]),
        after: state(10, [
          [A, 2],
          [B, 8],
        ]),
        bookingOutRows: [out("bo1", "s1", loc(A), 5)],
        custodyRows: [],
        destinationLocationId: B,
      })
    ).toEqual({
      bookingMoves: [
        {
          sourceRowId: "bo1",
          sliceId: "s1",
          fromKey: loc(A),
          toKey: loc(B),
          units: 2,
        },
      ],
      custodyMoves: [],
    });
  });

  it("A 5 custody + 5 booking out, move 6 to B: booking 5 first, then custody 1", () => {
    const result = planSourceRehome({
      before: state(10, [[A, 10]]),
      after: state(10, [
        [A, 4],
        [B, 6],
      ]),
      bookingOutRows: [out("bo1", "s1", loc(A), 5)],
      custodyRows: [custody("c1", A, 5)],
      destinationLocationId: B,
    });
    expect(result).toEqual({
      bookingMoves: [
        {
          sourceRowId: "bo1",
          sliceId: "s1",
          fromKey: loc(A),
          toKey: loc(B),
          units: 5,
        },
      ],
      custodyMoves: [
        {
          rowId: "c1",
          teamMemberId: "tm-1",
          fromLocationId: A,
          toLocationId: B,
          quantity: 1,
        },
      ],
    });
    // B never holds more than its 6 placed units.
    const intoB =
      result.bookingMoves
        .filter((m) => m.toKey === loc(B))
        .reduce((sum, m) => sum + m.units, 0) +
      result.custodyMoves
        .filter((m) => m.toLocationId === B)
        .reduce((sum, m) => sum + m.quantity, 0);
    expect(intoB).toBe(6);
  });

  it("drains booking rows latest checked out first, then by row id", () => {
    const { bookingMoves } = planSourceRehome({
      before: state(10, [[A, 10]]),
      after: state(10, [
        [A, 3],
        [B, 7],
      ]),
      bookingOutRows: [
        out("bo-old", "s-old", loc(A), 4, "2026-01-01T00:00:00.000Z"),
        out("bo-new", "s-new", loc(A), 2, "2026-01-05T00:00:00.000Z"),
        out("bo-tie-b", "s-tie-b", loc(A), 1, "2026-01-03T00:00:00.000Z"),
        out("bo-tie-a", "s-tie-a", loc(A), 1, "2026-01-03T00:00:00.000Z"),
      ],
      custodyRows: [],
      destinationLocationId: B,
    });
    // Excess = min(8 - 3, 10 - 3) = 5.
    expect(bookingMoves.map((m) => [m.sourceRowId, m.toKey, m.units])).toEqual([
      ["bo-new", loc(B), 2],
      ["bo-tie-a", loc(B), 1],
      ["bo-tie-b", loc(B), 1],
      ["bo-old", loc(B), 1],
    ]);
  });

  it("sends units to Unplaced only when it really covers them, else Unknown", () => {
    const before = state(10, [
      [A, 6],
      [B, 4],
    ]);
    // 4 units of A became unplaced. Excess at A = min(5 - 2, 6 - 2) = 3.
    const after = state(10, [
      [A, 2],
      [B, 4],
    ]);

    expect(
      planSourceRehome({
        before,
        after,
        bookingOutRows: [out("bo1", "s1", loc(A), 5)],
        custodyRows: [],
      }).bookingMoves
    ).toEqual([
      {
        sourceRowId: "bo1",
        sliceId: "s1",
        fromKey: loc(A),
        toKey: "UNPLACED:",
        units: 3,
      },
    ]);

    // 2 of the 4 unplaced units are in custody: only 2 fit at Unplaced.
    const partial = planSourceRehome({
      before,
      after,
      bookingOutRows: [out("bo1", "s1", loc(A), 5)],
      custodyRows: [custody("cu", null, 2)],
    });
    expect(
      partial.bookingMoves.map((m) => [m.sourceRowId, m.toKey, m.units])
    ).toEqual([
      ["bo1", "UNPLACED:", 2],
      ["bo1", "UNKNOWN:", 1],
    ]);
    expect(partial.custodyMoves).toEqual([]);
  });

  it("sends units to Unknown when the destination is full and nothing is unplaced", () => {
    const { bookingMoves } = planSourceRehome({
      before: state(10, [
        [A, 6],
        [B, 4],
      ]),
      after: state(10, [
        [A, 3],
        [B, 7],
      ]),
      bookingOutRows: [
        out("bo-a", "s1", loc(A), 5),
        out("bo-b", "s2", loc(B), 7),
      ],
      custodyRows: [],
      destinationLocationId: B,
    });
    expect(bookingMoves).toEqual([
      {
        sourceRowId: "bo-a",
        sliceId: "s1",
        fromKey: loc(A),
        toKey: "UNKNOWN:",
        units: 2,
      },
    ]);
  });

  it("moves unplaced booking units to a single destination, else to Unknown", () => {
    // Placing 8 of 10 unplaced units at A, 6 out from Unplaced: excess 4.
    expect(
      planSourceRehome({
        before: state(10, []),
        after: state(10, [[A, 8]]),
        bookingOutRows: [out("bo-u", "s1", "UNPLACED:", 6)],
        custodyRows: [],
        destinationLocationId: A,
      }).bookingMoves
    ).toEqual([
      {
        sourceRowId: "bo-u",
        sliceId: "s1",
        fromKey: "UNPLACED:",
        toKey: loc(A),
        units: 4,
      },
    ]);

    // Several receiving locations: no single destination, so Unknown.
    expect(
      planSourceRehome({
        before: state(10, []),
        after: state(10, [
          [A, 6],
          [B, 4],
        ]),
        bookingOutRows: [out("bo-u", "s1", "UNPLACED:", 6)],
        custodyRows: [],
      }).bookingMoves
    ).toEqual([
      {
        sourceRowId: "bo-u",
        sliceId: "s1",
        fromKey: "UNPLACED:",
        toKey: "UNKNOWN:",
        units: 6,
      },
    ]);
  });

  it("never counts UNKNOWN and KIT rows as occupancy, and never moves them", () => {
    const { bookingMoves, custodyMoves } = planSourceRehome({
      before: state(10, [
        [A, 4],
        [B, 6],
      ]),
      after: state(10, [
        [A, 2],
        [B, 8],
      ]),
      bookingOutRows: [
        out("unk", "s1", "UNKNOWN:", 6),
        out("kit", "s2", "KIT:", 3),
        out("bo-a", "s3", loc(A), 4),
      ],
      custodyRows: [],
      destinationLocationId: B,
    });
    expect(bookingMoves).toEqual([
      {
        sourceRowId: "bo-a",
        sliceId: "s3",
        fromKey: loc(A),
        toKey: loc(B),
        units: 2,
      },
    ]);
    expect(custodyMoves).toEqual([]);
  });
});

describe("planLocationDeleteEvacuation", () => {
  /** quantity 10, out 4, released 3: 3 pending and 3 units of history. */
  const mixedRow = (mode: "AUTO" | "MANUAL") =>
    sourceRow({
      id: "r-a",
      sliceId: "s1",
      locationId: A,
      quantity: 10,
      outQuantity: 4,
      releasedQuantity: 3,
      dispatchedTotal: 7,
      sharedQuantity: 3,
      mode,
      sliceCheckedOutAt: new Date("2026-01-05T00:00:00.000Z"),
    });

  /** An existing UNPLACED target row of the same slice (never an origin). */
  const unplacedTarget = sourceRow({
    id: "r-up",
    sliceId: "s1",
    kind: "UNPLACED",
    locationId: null,
    quantity: 2,
    outQuantity: 2,
    dispatchedTotal: 2,
  });

  const freeBySlice = new Map([
    [
      "s1",
      [
        {
          kind: "UNPLACED" as const,
          locationId: null,
          free: 0,
          createdOrder: 0,
        },
        { kind: "LOCATION" as const, locationId: C, free: 2, createdOrder: 1 },
        // A is being deleted: never a destination even when listed.
        { kind: "LOCATION" as const, locationId: A, free: 9, createdOrder: 0 },
      ],
    ],
  ]);

  it("delete A with q10 out4 rel3 (AUTO): every part goes to its own target", () => {
    expect(
      planLocationDeleteEvacuation({
        deletedLocationIds: [A],
        rows: [mixedRow("AUTO"), unplacedTarget],
        freeBySlice,
        unplacedRoomForOut: 1,
      })
    ).toEqual([
      {
        type: "partialMove",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNPLACED:",
        units: 1,
      },
      {
        type: "partialMove",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNKNOWN:",
        units: 3,
      },
      {
        type: "moveHistory",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNKNOWN:",
      },
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: loc(C),
        units: 2,
      },
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNASSIGNED:",
        units: 1,
      },
      { type: "moveReleased", sliceId: "s1", fromRowId: "r-a", units: 3 },
      { type: "deleteRow", sourceRowId: "r-a" },
    ]);
  });

  it("delete A with q10 out4 rel3 (MANUAL): pending goes to UNASSIGNED", () => {
    const writes = planLocationDeleteEvacuation({
      deletedLocationIds: [A],
      rows: [mixedRow("MANUAL"), unplacedTarget],
      freeBySlice,
      unplacedRoomForOut: 1,
    });
    expect(writes.filter((w) => w.type === "movePending")).toEqual([
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNASSIGNED:",
        units: 3,
      },
    ]);
    expect(writes[writes.length - 1]).toEqual({
      type: "deleteRow",
      sourceRowId: "r-a",
    });
  });

  it("moves only the history of a history-only carrier", () => {
    expect(
      planLocationDeleteEvacuation({
        deletedLocationIds: [A],
        rows: [
          sourceRow({
            id: "r-h",
            sliceId: "s1",
            dispatchedTotal: 5,
            sharedQuantity: 5,
          }),
        ],
        freeBySlice,
        unplacedRoomForOut: 10,
      })
    ).toEqual([
      {
        type: "moveHistory",
        sliceId: "s1",
        fromRowId: "r-h",
        toKey: "UNKNOWN:",
      },
      { type: "deleteRow", sourceRowId: "r-h" },
    ]);
  });

  it("never lets two deleted locations claim the same unplaced room", () => {
    expect(
      planLocationDeleteEvacuation({
        deletedLocationIds: [A, B],
        rows: [
          sourceRow({
            id: "r-b",
            sliceId: "s2",
            locationId: B,
            quantity: 3,
            outQuantity: 3,
            dispatchedTotal: 3,
            sliceCheckedOutAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
          sourceRow({
            id: "r-a",
            sliceId: "s1",
            locationId: A,
            quantity: 4,
            outQuantity: 4,
            dispatchedTotal: 4,
            sliceCheckedOutAt: new Date("2026-01-05T00:00:00.000Z"),
          }),
        ],
        freeBySlice: new Map(),
        unplacedRoomForOut: 5,
      })
    ).toEqual([
      {
        type: "partialMove",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: "UNPLACED:",
        units: 4,
      },
      { type: "deleteRow", sourceRowId: "r-a" },
      {
        type: "partialMove",
        sliceId: "s2",
        fromRowId: "r-b",
        toKey: "UNPLACED:",
        units: 1,
      },
      {
        type: "partialMove",
        sliceId: "s2",
        fromRowId: "r-b",
        toKey: "UNKNOWN:",
        units: 2,
      },
      { type: "deleteRow", sourceRowId: "r-b" },
    ]);
  });

  it("re-allocates the pending of two deleted locations once over the slice's free", () => {
    expect(
      planLocationDeleteEvacuation({
        deletedLocationIds: [A, B],
        rows: [
          sourceRow({ id: "r-a", sliceId: "s1", locationId: A, quantity: 3 }),
          sourceRow({ id: "r-b", sliceId: "s1", locationId: B, quantity: 3 }),
        ],
        freeBySlice: new Map([
          [
            "s1",
            [
              {
                kind: "LOCATION" as const,
                locationId: C,
                free: 4,
                createdOrder: 1,
              },
            ],
          ],
        ]),
        unplacedRoomForOut: 0,
      })
    ).toEqual([
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-a",
        toKey: loc(C),
        units: 3,
      },
      { type: "deleteRow", sourceRowId: "r-a" },
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-b",
        toKey: loc(C),
        units: 1,
      },
      {
        type: "movePending",
        sliceId: "s1",
        fromRowId: "r-b",
        toKey: "UNASSIGNED:",
        units: 2,
      },
      { type: "deleteRow", sourceRowId: "r-b" },
    ]);
  });

  it("bulk delete A and B into one UNKNOWN target aggregates once", () => {
    const checkedOut = new Date("2026-01-05T00:00:00.000Z");
    const rows = [
      // 4 out, 2 history, 2 pending.
      sourceRow({
        id: "r-a",
        sliceId: "s1",
        locationId: A,
        quantity: 6,
        outQuantity: 4,
        dispatchedTotal: 6,
        sharedQuantity: 2,
        mode: "MANUAL",
        sliceCheckedOutAt: checkedOut,
      }),
      // 3 out, 2 history, 2 released.
      sourceRow({
        id: "r-b",
        sliceId: "s1",
        locationId: B,
        quantity: 5,
        outQuantity: 3,
        releasedQuantity: 2,
        dispatchedTotal: 5,
        sharedQuantity: 2,
        mode: "MANUAL",
        sliceCheckedOutAt: checkedOut,
      }),
      // An existing UNKNOWN row of the slice: a target, never an origin.
      sourceRow({
        id: "r-unk",
        sliceId: "s1",
        kind: "UNKNOWN",
        locationId: null,
        quantity: 1,
        outQuantity: 1,
        dispatchedTotal: 1,
        mode: "MANUAL",
        sliceCheckedOutAt: checkedOut,
      }),
    ];
    const writes = planLocationDeleteEvacuation({
      deletedLocationIds: [A, B],
      rows,
      freeBySlice: new Map(),
      unplacedRoomForOut: 0,
    });
    expect(writes.filter((w) => w.type === "deleteRow")).toEqual([
      { type: "deleteRow", sourceRowId: "r-a" },
      { type: "deleteRow", sourceRowId: "r-b" },
    ]);
    expect(aggregateEvacuationTargets(writes, rows)).toEqual([
      {
        sliceId: "s1",
        toKey: "UNKNOWN:",
        quantity: 7,
        outQuantity: 7,
        releasedQuantity: 0,
        dispatchedTotal: 11,
        sharedQuantity: 4,
      },
      {
        sliceId: "s1",
        toKey: "UNASSIGNED:",
        quantity: 4,
        outQuantity: 0,
        releasedQuantity: 2,
        dispatchedTotal: 0,
        sharedQuantity: 0,
      },
    ]);
  });
});
