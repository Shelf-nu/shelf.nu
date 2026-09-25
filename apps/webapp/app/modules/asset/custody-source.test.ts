import { describe, expect, it } from "vitest";
import type { CustodyRowForPlan, CustodySourceState } from "./custody-source";
import {
  UNPLACED_SOURCE,
  buildCustodySourceOptions,
  defaultSourceOption,
  hasMultipleSources,
  orderRowsForDrain,
  planCustodyRehome,
  planDrainRelease,
  resolveCustodySource,
  unitsLeftAtSource,
  unplacedUnits,
} from "./custody-source";

const A = "loc-camera-room";
const B = "loc-studio";
const C = "loc-annex";

function state(
  total: number,
  placements: Array<[string, number]>,
  custody: Array<[string | null, number]> = []
): CustodySourceState {
  return {
    total,
    placements: placements.map(([locationId, quantity]) => ({
      locationId,
      quantity,
    })),
    operatorCustody: custody.map(([locationId, quantity]) => ({
      locationId,
      quantity,
    })),
  };
}

function row(
  id: string,
  locationId: string | null,
  quantity: number,
  createdAt = "2026-09-01T00:00:00.000Z",
  teamMemberId = "tm-1"
): CustodyRowForPlan {
  return { id, teamMemberId, locationId, quantity, createdAt };
}

describe("unitsLeftAtSource", () => {
  it("is placed minus custody from that location", () => {
    const s = state(
      4,
      [
        [A, 2],
        [B, 2],
      ],
      [[B, 2]]
    );
    expect(unitsLeftAtSource(s, A)).toBe(2);
    expect(unitsLeftAtSource(s, B)).toBe(0);
  });

  it("uses the unplaced units for NULL", () => {
    const s = state(
      7,
      [
        [A, 2],
        [B, 2],
      ],
      [[null, 1]]
    );
    expect(unplacedUnits(s)).toBe(3);
    expect(unitsLeftAtSource(s, null)).toBe(2);
  });

  it("never goes negative for custody that was never recorded", () => {
    // Fully placed pool with legacy NULL custody: nothing is unplaced.
    const s = state(
      4,
      [
        [A, 2],
        [B, 2],
      ],
      [[null, 3]]
    );
    expect(unitsLeftAtSource(s, null)).toBe(0);
  });

  it("is zero for a location the pool is not placed at", () => {
    expect(unitsLeftAtSource(state(4, [[A, 4]]), C)).toBe(0);
  });

  it("treats a drifted pool (placed above total) as having nothing unplaced", () => {
    expect(
      unplacedUnits(
        state(90, [
          [A, 60],
          [B, 40],
        ])
      )
    ).toBe(0);
  });
});

describe("hasMultipleSources", () => {
  it("is false with no placements", () => {
    expect(hasMultipleSources(state(10, []))).toBe(false);
  });

  it("is false for a pool fully at one location", () => {
    expect(hasMultipleSources(state(10, [[A, 10]]))).toBe(false);
  });

  it("is false for one location plus unplaced units", () => {
    // Unplaced units never open the gate on their own: this pool asks
    // nothing and records no source, exactly as before.
    expect(hasMultipleSources(state(10, [[A, 4]]))).toBe(false);
  });

  it("is true for two locations", () => {
    expect(
      hasMultipleSources(
        state(4, [
          [A, 2],
          [B, 2],
        ])
      )
    ).toBe(true);
  });
});

describe("buildCustodySourceOptions", () => {
  const names = [
    { id: A, name: "Camera Room" },
    { id: B, name: "Studio" },
  ];

  it("lists placements in order, then Unplaced when there are unplaced units", () => {
    const options = buildCustodySourceOptions(
      state(
        7,
        [
          [A, 2],
          [B, 2],
        ],
        [[A, 1]]
      ),
      names
    );
    expect(options).toEqual([
      {
        value: A,
        locationId: A,
        label: "Camera Room",
        placed: 2,
        inCustody: 1,
        left: 1,
      },
      {
        value: B,
        locationId: B,
        label: "Studio",
        placed: 2,
        inCustody: 0,
        left: 2,
      },
      {
        value: UNPLACED_SOURCE,
        locationId: null,
        label: "Unplaced",
        placed: 3,
        inCustody: 0,
        left: 3,
      },
    ]);
  });

  it("omits Unplaced for a fully placed pool", () => {
    const options = buildCustodySourceOptions(
      state(4, [
        [A, 2],
        [B, 2],
      ]),
      names
    );
    expect(options.map((o) => o.label)).toEqual(["Camera Room", "Studio"]);
  });

  it("adds the parent's name to locations that share a name", () => {
    const options = buildCustodySourceOptions(
      state(4, [
        [A, 2],
        [B, 2],
      ]),
      [
        { id: A, name: "Shelf 1", parentName: "Warehouse" },
        { id: B, name: "Shelf 1", parentName: "Office" },
      ]
    );
    expect(options.map((o) => o.label)).toEqual([
      "Shelf 1 (Warehouse)",
      "Shelf 1 (Office)",
    ]);
  });
});

describe("defaultSourceOption", () => {
  it("pre-selects the option with the most units left", () => {
    const options = buildCustodySourceOptions(
      state(
        8,
        [
          [A, 4],
          [B, 3],
        ],
        [[A, 3]]
      ),
      [
        { id: A, name: "Camera Room" },
        { id: B, name: "Studio" },
      ]
    );
    // Camera Room 1 left, Studio 3 left, Unplaced 1 left.
    expect(defaultSourceOption(options)?.locationId).toBe(B);
  });

  it("keeps the first option on a tie", () => {
    const options = buildCustodySourceOptions(
      state(4, [
        [A, 2],
        [B, 2],
      ]),
      [
        { id: A, name: "Camera Room" },
        { id: B, name: "Studio" },
      ]
    );
    expect(defaultSourceOption(options)?.locationId).toBe(A);
  });

  it("never pre-selects Unplaced, even when it has the most left", () => {
    const options = buildCustodySourceOptions(
      state(
        20,
        [
          [A, 2],
          [B, 3],
        ],
        [[B, 3]]
      ),
      [
        { id: A, name: "Camera Room" },
        { id: B, name: "Studio" },
      ]
    );
    // Camera Room 2 left, Studio 0 left, Unplaced 15 left.
    expect(options.map((o) => o.left)).toEqual([2, 0, 15]);
    expect(defaultSourceOption(options)?.locationId).toBe(A);
  });

  it("returns null when there is no location to pre-select", () => {
    expect(defaultSourceOption([])).toBeNull();
    expect(
      defaultSourceOption([
        {
          value: "unplaced",
          locationId: null,
          label: "Unplaced",
          placed: 3,
          inCustody: 0,
          left: 3,
        },
      ])
    ).toBeNull();
  });
});

describe("resolveCustodySource", () => {
  it("uses a submitted location", () => {
    expect(
      resolveCustodySource({
        submitted: B,
        state: state(4, [
          [A, 2],
          [B, 2],
        ]),
      })
    ).toEqual({ locationId: B, explicit: true });
  });

  it("reads the unplaced word, an empty string or null as an explicit choice of the unplaced units", () => {
    const s = state(7, [[A, 2]]);
    expect(
      resolveCustodySource({ submitted: UNPLACED_SOURCE, state: s })
    ).toEqual({
      locationId: null,
      explicit: true,
    });
    expect(resolveCustodySource({ submitted: "", state: s })).toEqual({
      locationId: null,
      explicit: true,
    });
    expect(resolveCustodySource({ submitted: null, state: s })).toEqual({
      locationId: null,
      explicit: true,
    });
  });

  it("fills in the only placement when nothing is submitted and nothing is unplaced", () => {
    expect(
      resolveCustodySource({ submitted: undefined, state: state(4, [[A, 4]]) })
    ).toEqual({ locationId: A, explicit: false });
  });

  it("records nothing for a pool with no placements", () => {
    expect(
      resolveCustodySource({ submitted: undefined, state: state(4, []) })
    ).toEqual({ locationId: null, explicit: false });
  });

  it("records nothing for one placement plus unplaced units (older client)", () => {
    expect(
      resolveCustodySource({ submitted: undefined, state: state(7, [[A, 4]]) })
    ).toEqual({ locationId: null, explicit: false });
  });

  it("records nothing for a pool at two locations (older client)", () => {
    expect(
      resolveCustodySource({
        submitted: undefined,
        state: state(4, [
          [A, 2],
          [B, 2],
        ]),
      })
    ).toEqual({ locationId: null, explicit: false });
  });
});

describe("orderRowsForDrain / planDrainRelease", () => {
  const rows = [
    row("r-small-old", A, 1, "2026-09-01T00:00:00.000Z"),
    row("r-big", B, 3, "2026-09-03T00:00:00.000Z"),
    row("r-small-new", null, 1, "2026-09-02T00:00:00.000Z"),
  ];

  it("draws the largest row first, then the oldest", () => {
    expect(orderRowsForDrain(rows).map((r) => r.id)).toEqual([
      "r-big",
      "r-small-old",
      "r-small-new",
    ]);
  });

  it("spreads a release across rows in drain order", () => {
    expect(planDrainRelease({ rows, quantity: 4, consumed: 0 })).toEqual([
      { rowId: "r-big", locationId: B, quantity: 3, consumed: 0 },
      { rowId: "r-small-old", locationId: A, quantity: 1, consumed: 0 },
    ]);
  });

  it("assigns consumed units to the first rows drawn", () => {
    expect(planDrainRelease({ rows, quantity: 5, consumed: 4 })).toEqual([
      { rowId: "r-big", locationId: B, quantity: 3, consumed: 3 },
      { rowId: "r-small-old", locationId: A, quantity: 1, consumed: 1 },
      { rowId: "r-small-new", locationId: null, quantity: 1, consumed: 0 },
    ]);
  });
});

describe("planCustodyRehome", () => {
  it("moves nothing while the location keeps enough units (free units leave first)", () => {
    // Camera Room 4 placed, 2 in custody. Move 2 away: 2 left, still covers custody.
    const moves = planCustodyRehome({
      before: state(8, [
        [A, 4],
        [B, 4],
      ]),
      after: state(8, [
        [A, 2],
        [B, 6],
      ]),
      rows: [row("r1", A, 2)],
      destinationLocationId: B,
    });
    expect(moves).toEqual([]);
  });

  it("moves only the excess to the destination, splitting a row", () => {
    // Camera Room 4 placed, 3 in custody. Move 3 away: 1 left, 2 excess.
    const moves = planCustodyRehome({
      before: state(8, [
        [A, 4],
        [B, 4],
      ]),
      after: state(8, [
        [A, 1],
        [B, 7],
      ]),
      rows: [row("r1", A, 3)],
      destinationLocationId: B,
    });
    expect(moves).toEqual([
      {
        rowId: "r1",
        teamMemberId: "tm-1",
        fromLocationId: A,
        toLocationId: B,
        quantity: 2,
      },
    ]);
  });

  it("takes all custody along on a whole-pool move", () => {
    const moves = planCustodyRehome({
      before: state(10, [
        [A, 4],
        [B, 4],
      ]),
      after: state(10, [[C, 10]]),
      rows: [
        row("r1", A, 3),
        row("r2", B, 2, undefined, "tm-2"),
        row("r3", null, 1),
      ],
      destinationLocationId: C,
    });
    expect(moves).toEqual([
      {
        rowId: "r1",
        teamMemberId: "tm-1",
        fromLocationId: A,
        toLocationId: C,
        quantity: 3,
      },
      {
        rowId: "r2",
        teamMemberId: "tm-2",
        fromLocationId: B,
        toLocationId: C,
        quantity: 2,
      },
      {
        rowId: "r3",
        teamMemberId: "tm-1",
        fromLocationId: null,
        toLocationId: C,
        quantity: 1,
      },
    ]);
  });

  it("makes the excess unplaced when a placement shrinks with no destination", () => {
    const moves = planCustodyRehome({
      before: state(4, [
        [A, 2],
        [B, 2],
      ]),
      after: state(4, [
        [A, 2],
        [B, 1],
      ]),
      rows: [row("r1", B, 2)],
    });
    expect(moves).toEqual([
      {
        rowId: "r1",
        teamMemberId: "tm-1",
        fromLocationId: B,
        toLocationId: null,
        quantity: 1,
      },
    ]);
  });

  it("makes every unit out from a cleared location unplaced", () => {
    const moves = planCustodyRehome({
      before: state(4, [
        [A, 2],
        [B, 2],
      ]),
      after: state(4, []),
      rows: [row("r1", A, 2), row("r2", B, 1)],
      destinationLocationId: null,
    });
    expect(moves.map((m) => [m.rowId, m.toLocationId, m.quantity])).toEqual([
      ["r1", null, 2],
      ["r2", null, 1],
    ]);
  });

  it("sends only what fits to the destination and the rest to unplaced", () => {
    // Collapse onto Annex with only 2 units placed there.
    const moves = planCustodyRehome({
      before: state(10, [
        [A, 4],
        [B, 4],
      ]),
      after: state(10, [[C, 2]]),
      rows: [row("r1", A, 3)],
      destinationLocationId: C,
    });
    expect(moves.map((m) => [m.toLocationId, m.quantity])).toEqual([
      [C, 2],
      [null, 1],
    ]);
  });

  it("moves unplaced custody to the one destination the unplaced units went to", () => {
    // 10 unplaced, 6 in custody. Place 8 at Camera Room: 2 unplaced left.
    const moves = planCustodyRehome({
      before: state(10, []),
      after: state(10, [[A, 8]]),
      rows: [row("r1", null, 6)],
      destinationLocationId: A,
    });
    expect(moves).toEqual([
      {
        rowId: "r1",
        teamMemberId: "tm-1",
        fromLocationId: null,
        toLocationId: A,
        quantity: 4,
      },
    ]);
  });

  it("leaves unplaced custody unrecorded when several locations received units", () => {
    const moves = planCustodyRehome({
      before: state(10, []),
      after: state(10, [
        [A, 6],
        [B, 4],
      ]),
      rows: [row("r1", null, 4)],
    });
    expect(moves).toEqual([]);
  });

  it("does not touch custody that already exceeded its location before the change", () => {
    // Legacy drift: 3 in custody from a location holding 2. Growing another
    // location must not move it.
    const moves = planCustodyRehome({
      before: state(6, [
        [A, 2],
        [B, 2],
      ]),
      after: state(6, [
        [A, 2],
        [B, 4],
      ]),
      rows: [row("r1", A, 3)],
    });
    expect(moves).toEqual([]);
  });
});
