import { describe, expect, it } from "vitest";
import type { StockState } from "./stock-ledger";
import {
  diffStockStates,
  emptyStockState,
  planStockLedgerRows,
  replayStockLedger,
  stockByPlace,
  unplacedUnits,
} from "./stock-ledger";

const STUDIO = "loc-studio";
const CAMERA = "loc-camera";

function state(total: number, placed: Array<[string, number]>): StockState {
  return { total, placed: new Map(placed), ledgerStartedAt: null };
}

/** The rows as `[category, locationId, stockChange]`, the part a replay reads. */
const shape = (rows: ReturnType<typeof planStockLedgerRows>["rows"]) =>
  rows.map((row) => [row.category, row.locationId, row.stockChange]);

describe("unplacedUnits / stockByPlace", () => {
  it("counts what is not placed, negative when placements exceed the total", () => {
    expect(unplacedUnits(state(10, [[STUDIO, 4]]))).toBe(6);
    expect(
      unplacedUnits(
        state(5, [
          [STUDIO, 4],
          [CAMERA, 3],
        ])
      )
    ).toBe(-2);
  });

  it("lists every non-zero place, unplaced first", () => {
    expect(
      stockByPlace(
        state(10, [
          [STUDIO, 4],
          [CAMERA, 6],
        ])
      )
    ).toEqual([
      { locationId: CAMERA, change: 6 },
      { locationId: STUDIO, change: 4 },
    ]);
    expect(stockByPlace(state(3, [[STUDIO, 5]]))).toEqual([
      { locationId: null, change: -2 },
      { locationId: STUDIO, change: 5 },
    ]);
  });
});

describe("diffStockStates", () => {
  it("reports each place that changed and nothing else", () => {
    expect(
      diffStockStates(
        state(10, [
          [STUDIO, 4],
          [CAMERA, 6],
        ]),
        state(10, [
          [STUDIO, 6],
          [CAMERA, 4],
        ])
      )
    ).toEqual([
      { locationId: CAMERA, change: -2 },
      { locationId: STUDIO, change: 2 },
    ]);
  });

  it("sees a placement that disappeared and one that appeared", () => {
    expect(
      diffStockStates(state(10, [[STUDIO, 10]]), state(10, [[CAMERA, 10]]))
    ).toEqual([
      { locationId: CAMERA, change: 10 },
      { locationId: STUDIO, change: -10 },
    ]);
  });

  it("puts a total change with no placement change on the unplaced units", () => {
    expect(
      diffStockStates(state(10, [[STUDIO, 4]]), state(7, [[STUDIO, 4]]))
    ).toEqual([{ locationId: null, change: -3 }]);
  });
});

describe("planStockLedgerRows", () => {
  it("labels a single-place change with its event", () => {
    const { rows, unexplained } = planStockLedgerRows({
      changes: [{ locationId: STUDIO, change: 5 }],
      events: [{ category: "RESTOCK", change: 5, locationId: STUDIO }],
    });
    expect(shape(rows)).toEqual([["RESTOCK", STUDIO, 5]]);
    expect(rows[0].quantity).toBe(5);
    expect(unexplained).toBe(0);
  });

  it("writes an event where the units actually left, when that is not where the caller expected", () => {
    // Consumed 5 with no recorded source: the reconcile drained 3 unplaced
    // units, then 2 from the only placement.
    const { rows } = planStockLedgerRows({
      changes: [
        { locationId: null, change: -3 },
        { locationId: STUDIO, change: -2 },
      ],
      events: [
        {
          category: "CONSUME",
          change: -5,
          locationId: null,
          bookingId: "b-1",
          bookingAssetId: "ba-1",
        },
      ],
    });
    expect(shape(rows)).toEqual([
      ["CONSUME", null, -3],
      ["CONSUME", STUDIO, -2],
    ]);
    // Every split row keeps the event's booking attribution, so readers that
    // sum dispositions per slice see the same 5.
    expect(rows.every((row) => row.bookingAssetId === "ba-1")).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);
  });

  it("tries the event's own location first", () => {
    // Unplaced units also went down, but a move carried them to Camera; the
    // loss happened at Studio, where the caller says it did.
    const { rows } = planStockLedgerRows({
      changes: [
        { locationId: null, change: -2 },
        { locationId: CAMERA, change: 2 },
        { locationId: STUDIO, change: -2 },
      ],
      events: [{ category: "LOSS", change: -2, locationId: STUDIO }],
    });
    expect(shape(rows)).toEqual([
      ["LOSS", STUDIO, -2],
      ["MOVE", null, -2],
      ["MOVE", CAMERA, 2],
    ]);
  });

  it("turns units that only changed place into MOVE rows that sum to zero", () => {
    const { rows } = planStockLedgerRows({
      changes: [
        { locationId: CAMERA, change: -4 },
        { locationId: STUDIO, change: 4 },
      ],
      events: [],
    });
    expect(shape(rows)).toEqual([
      ["MOVE", CAMERA, -4],
      ["MOVE", STUDIO, 4],
    ]);
    expect(rows.reduce((sum, row) => sum + row.stockChange, 0)).toBe(0);
  });

  it("splits a total change and a move made in one save", () => {
    // Edit form: total 10 -> 15 and the location changed from Camera to Studio.
    const { rows } = planStockLedgerRows({
      changes: [
        { locationId: CAMERA, change: -10 },
        { locationId: STUDIO, change: 15 },
      ],
      events: [{ category: "ADJUSTMENT", change: 5 }],
    });
    expect(shape(rows)).toEqual([
      ["ADJUSTMENT", STUDIO, 5],
      ["MOVE", CAMERA, -10],
      ["MOVE", STUDIO, 10],
    ]);
  });

  it("splits several events over the places that moved", () => {
    const { rows } = planStockLedgerRows({
      changes: [
        { locationId: null, change: -4 },
        { locationId: STUDIO, change: -6 },
      ],
      events: [
        { category: "CONSUME", change: -5, locationId: STUDIO },
        { category: "LOSS", change: -3, locationId: STUDIO },
        { category: "DAMAGE", change: -2, locationId: STUDIO },
      ],
    });
    expect(shape(rows)).toEqual([
      ["CONSUME", STUDIO, -5],
      ["LOSS", STUDIO, -1],
      ["LOSS", null, -2],
      ["DAMAGE", null, -2],
    ]);
  });

  it("keeps two events of opposite direction at one place, which the diff cannot see", () => {
    const { rows } = planStockLedgerRows({
      changes: [],
      events: [
        { category: "RESTOCK", change: 5, locationId: STUDIO },
        { category: "LOSS", change: -5, locationId: STUDIO },
      ],
    });
    expect(shape(rows)).toEqual([
      ["RESTOCK", STUDIO, 5],
      ["LOSS", STUDIO, -5],
    ]);
  });

  it("records a change the events do not explain as an ADJUSTMENT and reports it", () => {
    const { rows, unexplained } = planStockLedgerRows({
      changes: [{ locationId: null, change: -7 }],
      events: [{ category: "CONSUME", change: -5 }],
    });
    expect(unexplained).toBe(-2);
    expect(shape(rows)).toEqual([
      ["CONSUME", null, -5],
      ["ADJUSTMENT", null, -2],
    ]);
  });

  it("always sums to the change at every place", () => {
    const changes = [
      { locationId: null, change: 3 },
      { locationId: CAMERA, change: -9 },
      { locationId: STUDIO, change: 2 },
    ];
    const { rows } = planStockLedgerRows({
      changes,
      events: [{ category: "LOSS", change: -4, locationId: CAMERA }],
    });
    const replayed = replayStockLedger(rows);
    expect(replayed.total).toBe(-4);
    expect(replayed.byPlace).toEqual(
      new Map([
        ["", 3],
        [CAMERA, -9],
        [STUDIO, 2],
      ])
    );
  });
});

describe("replayStockLedger", () => {
  it("rebuilds a pool from its opening balance and changes, ignoring rows from before the ledger", () => {
    const opening = stockByPlace(
      state(10, [
        [STUDIO, 4],
        [CAMERA, 5],
      ])
    ).map(({ locationId, change }) => ({ locationId, stockChange: change }));

    const replayed = replayStockLedger([
      { locationId: STUDIO, stockChange: null },
      ...opening,
      { locationId: STUDIO, stockChange: -4 },
      { locationId: null, stockChange: 4 },
      { locationId: CAMERA, stockChange: 0 },
    ]);

    expect(replayed).toEqual({
      total: 10,
      byPlace: new Map([
        ["", 5],
        [CAMERA, 5],
      ]),
    });
  });

  it("gives an empty stock for no rows", () => {
    expect(replayStockLedger([])).toEqual({ total: 0, byPlace: new Map() });
    expect(stockByPlace(emptyStockState())).toEqual([]);
  });
});
