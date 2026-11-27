/**
 * Tests for the in-memory check-in settlement: which rows a disposition is
 * settled on, the settle transition per row kind, the planned shares, and how
 * new logs are matched to them. Pure: no mocks.
 *
 * @see {@link file://./settlement.ts}
 */
import type { SourceRowState } from "@shelf/quantity-control";
import { describe, expect, it } from "vitest";

import { ShelfError } from "~/utils/error";

import { spreadUntaggedCheckin } from "../checkout-source-location";
import type { WorkingGroup, WorkingSlice } from "./conversion.server";
import {
  destroyedUnitsBySlice,
  emptySettlement,
  matchSharesToLogs,
  remainingInSettlement,
  settledPlacementSlice,
  settlementWindow,
  settleUnits,
  slicesUnderLock,
  unitsOutInSettlement,
} from "./settlement";
import type { Settlement, UnsharedLog } from "./settlement";

const POOL = "pool-1";

/** A persisted row with `out` units out of `quantity`. */
function row(
  id: string,
  kind: SourceRowState["kind"],
  counters: { quantity: number; out: number; released?: number },
  locationId: string | null = null
) {
  return {
    id,
    kind,
    locationId,
    quantity: counters.quantity,
    outQuantity: counters.out,
    releasedQuantity: counters.released ?? 0,
    dispatchedTotal: counters.out,
    sharedQuantity: 0,
  };
}

/** A converted slice. */
function slice(
  id: string,
  rows: WorkingSlice["rows"],
  overrides: Partial<WorkingSlice> = {}
): WorkingSlice {
  return {
    id,
    assetKitId: null,
    quantity: rows.reduce((sum, r) => sum + r.quantity, 0),
    checkedOutQuantity: rows.reduce((sum, r) => sum + r.dispatchedTotal, 0),
    originalMode: "AUTO",
    mode: "AUTO",
    rows,
    originalRows: new Map(),
    ...overrides,
  };
}

/** A settlement holding one converted group of POOL. */
function settlementOf(slices: WorkingSlice[]): Settlement {
  const group: WorkingGroup = {
    key: { bookingId: "booking-1", assetId: POOL },
    status: "converted",
    slices,
    insertShares: [],
    free: [],
  };
  return {
    ...emptySettlement({ organizationId: "org-1", bookingId: "booking-1" }),
    groups: new Map([[POOL, group]]),
  };
}

describe("settleUnits", () => {
  it("Reserve 10 at A, dispatch 5, return 1: 9 stay protected at A", () => {
    const rowA = row("r-a", "LOCATION", { quantity: 10, out: 5 }, "loc-a");
    const settlement = settlementOf([slice("s1", [rowA])]);

    const settled = settleUnits(settlement, {
      sliceId: "s1",
      assetId: POOL,
      returned: 1,
    });

    expect(rowA).toMatchObject({ outQuantity: 4, releasedQuantity: 1 });
    // Remaining reservation (pending + out) at A.
    expect(rowA.quantity - rowA.releasedQuantity).toBe(9);
    expect(settled).toEqual({
      legacy: false,
      bookingAssetId: "s1",
      shares: [{ sliceId: "s1", sourceRowId: "r-a", units: 1 }],
      destroyedFromLocations: [],
      returnLocationId: "loc-a",
    });
    expect(settlement.planned).toEqual([
      {
        assetId: POOL,
        category: "RETURN",
        sliceId: "s1",
        sourceKey: "LOCATION:loc-a",
        kind: "LOCATION",
        locationId: "loc-a",
        units: 1,
      },
    ]);
  });

  it("spreads an untagged return over the slices standalone first, even when a kit slice has more out", () => {
    const loose = row("r-u", "UNPLACED", { quantity: 3, out: 3 });
    const kit = row("r-k", "KIT", { quantity: 6, out: 6 });
    const settlement = settlementOf([
      slice("s-kit", [kit], { assetKitId: "ak-1", mode: "KIT" }),
      slice("s-loose", [loose]),
    ]);

    const settled = settleUnits(settlement, { assetId: POOL, returned: 5 });

    expect(settled.bookingAssetId).toBeNull();
    expect(settled.shares).toEqual([
      { sliceId: "s-loose", sourceRowId: "r-u", units: 3 },
      { sliceId: "s-kit", sourceRowId: "r-k", units: 2 },
    ]);
    expect(loose.outQuantity).toBe(0);
    expect(kit.outQuantity).toBe(4);
  });

  it("splits an untagged check-in over the same slices as the LEGACY spread", () => {
    // The same booking read two ways: as a converted group (rows with units
    // out) and as LEGACY slices (units sent, nothing logged back yet).
    const settlement = settlementOf([
      slice("s-kit", [row("r-k", "KIT", { quantity: 6, out: 6 })], {
        assetKitId: "ak-1",
        mode: "KIT",
      }),
      slice("s-loose", [row("r-u", "UNPLACED", { quantity: 3, out: 3 })]),
    ]);
    const legacy = spreadUntaggedCheckin({
      slices: [
        {
          id: "s-kit",
          assetKitId: "ak-1",
          sourceKitId: "kit-1",
          sourceLocationId: null,
          quantity: 6,
          checkedOutQuantity: 6,
          checkedOutAt: new Date("2026-01-05T09:00:00.000Z"),
        },
        {
          id: "s-loose",
          assetKitId: null,
          sourceKitId: null,
          sourceLocationId: null,
          quantity: 3,
          checkedOutQuantity: 3,
          checkedOutAt: new Date("2026-01-05T09:00:00.000Z"),
        },
      ],
      priorLogs: [],
      returned: 5,
    });

    settleUnits(settlement, { assetId: POOL, returned: 5 });

    const convertedBySlice = settlement.planned.map((p) => [
      p.sliceId,
      p.units,
    ]);
    expect(convertedBySlice).toEqual(
      legacy.map((share) => [share.bookingAssetId, share.returned])
    );
    expect(convertedBySlice).toEqual([
      ["s-loose", 3],
      ["s-kit", 2],
    ]);
  });

  it("tags the logs with the only slice an untagged request settled on", () => {
    const settlement = settlementOf([
      slice("s-loose", [row("r-u", "UNPLACED", { quantity: 5, out: 5 })]),
      slice("s-kit", [row("r-k", "KIT", { quantity: 5, out: 0 })], {
        assetKitId: "ak-1",
        mode: "KIT",
      }),
    ]);

    const settled = settleUnits(settlement, { assetId: POOL, returned: 3 });

    expect(settled.bookingAssetId).toBe("s-loose");
  });

  it("settles from UNKNOWN by moving the units to UNASSIGNED as released", () => {
    const unknown = row("r-x", "UNKNOWN", { quantity: 4, out: 4 });
    const theSlice = slice("s1", [unknown]);
    const settlement = settlementOf([theSlice]);

    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 4 });

    expect(unknown).toMatchObject({
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 4,
    });
    expect(theSlice.rows.find((r) => r.kind === "UNASSIGNED")).toMatchObject({
      quantity: 4,
      outQuantity: 0,
      releasedQuantity: 4,
      dispatchedTotal: 0,
    });
  });

  it("pours each category into the rows and names the placements destroyed units left", () => {
    const rowA = row("r-a", "LOCATION", { quantity: 3, out: 3 }, "loc-a");
    const unplaced = row("r-u", "UNPLACED", { quantity: 2, out: 2 });
    const settlement = settlementOf([slice("s1", [rowA, unplaced])]);

    const settled = settleUnits(settlement, {
      sliceId: "s1",
      assetId: POOL,
      returned: 2,
      consumed: 2,
      lost: 1,
    });

    expect(
      settlement.planned.map((p) => [p.category, p.sourceKey, p.units])
    ).toEqual([
      ["RETURN", "LOCATION:loc-a", 2],
      ["CONSUME", "LOCATION:loc-a", 1],
      ["CONSUME", "UNPLACED:", 1],
      ["LOSS", "UNPLACED:", 1],
    ]);
    expect(settled.destroyedFromLocations).toEqual([
      { locationId: "loc-a", quantity: 1 },
    ]);
    expect(settled.returnLocationId).toBe("loc-a");
    expect(settledPlacementSlice(settled)).toEqual({
      assetKitId: null,
      sourceKitId: null,
      sourceLocationId: "loc-a",
    });
    expect(destroyedUnitsBySlice(settlement, POOL)).toEqual(
      new Map([["s1", 3]])
    );
  });

  it("refuses units that are not out, changing nothing", () => {
    const rowA = row("r-a", "LOCATION", { quantity: 10, out: 2 }, "loc-a");
    const settlement = settlementOf([slice("s1", [rowA])]);
    const rowBefore = structuredClone(rowA);

    let error: unknown;
    try {
      settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 3 });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(ShelfError);
    expect((error as ShelfError).status).toBe(400);
    expect((error as ShelfError).message).toBe(
      "Cannot check in 3 units. Only 2 are out on this booking."
    );
    expect(rowA).toEqual(rowBefore);
    expect(settlement.planned).toEqual([]);
  });

  it("reports a group that is not converted as LEGACY and plans nothing", () => {
    const settlement = emptySettlement({
      organizationId: "org-1",
      bookingId: "booking-1",
    });

    expect(
      settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 2 })
    ).toEqual({
      legacy: true,
      bookingAssetId: "s1",
      shares: [],
      destroyedFromLocations: [],
      returnLocationId: null,
    });
    expect(unitsOutInSettlement(settlement, { assetId: POOL })).toBeNull();
  });

  it("counts units out per slice and per asset as settles go", () => {
    const settlement = settlementOf([
      slice("s1", [row("r-1", "UNPLACED", { quantity: 4, out: 4 })]),
      slice("s2", [row("r-2", "UNPLACED", { quantity: 3, out: 3 })]),
    ]);

    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 1 });

    expect(unitsOutInSettlement(settlement, { assetId: POOL })).toBe(6);
    expect(
      unitsOutInSettlement(settlement, { assetId: POOL, sliceId: "s1" })
    ).toBe(3);
  });
});

describe("matchSharesToLogs", () => {
  /** A new log of the booking. */
  function log(overrides: Partial<UnsharedLog> & { id: string }): UnsharedLog {
    return {
      assetId: POOL,
      bookingAssetId: null,
      category: "RETURN",
      quantity: 1,
      createdAt: new Date("2026-11-24T10:00:00Z"),
      ...overrides,
    };
  }

  it("gives one untagged 8-unit log two RECORDED shares", () => {
    const settlement = settlementOf([
      slice("s-loose", [row("r-u", "UNPLACED", { quantity: 5, out: 5 })]),
      slice("s-kit", [row("r-k", "KIT", { quantity: 5, out: 5 })], {
        assetKitId: "ak-1",
        mode: "KIT",
      }),
    ]);
    settleUnits(settlement, { assetId: POOL, returned: 8 });

    const match = matchSharesToLogs(settlement.planned, [
      log({ id: "log-1", quantity: 8 }),
    ]);

    expect(match).toEqual({
      ok: true,
      shares: [
        {
          consumptionLogId: "log-1",
          bookingAssetId: "s-loose",
          sourceKey: "UNPLACED:",
          quantity: 5,
          origin: "RECORDED",
        },
        {
          consumptionLogId: "log-1",
          bookingAssetId: "s-kit",
          sourceKey: "KIT:",
          quantity: 3,
          origin: "RECORDED",
        },
      ],
    });
  });

  it("gives a tagged log its own slice's pieces first", () => {
    const settlement = settlementOf([
      slice("s1", [row("r-1", "UNPLACED", { quantity: 2, out: 2 })]),
      slice("s2", [row("r-2", "LOCATION", { quantity: 3, out: 3 }, "loc-a")]),
    ]);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 2 });
    settleUnits(settlement, { sliceId: "s2", assetId: POOL, returned: 3 });

    const match = matchSharesToLogs(settlement.planned, [
      log({ id: "log-untagged", quantity: 2 }),
      log({ id: "log-s2", bookingAssetId: "s2", quantity: 3 }),
    ]);

    expect(match.ok && match.shares).toEqual([
      expect.objectContaining({
        consumptionLogId: "log-s2",
        bookingAssetId: "s2",
        quantity: 3,
      }),
      expect.objectContaining({
        consumptionLogId: "log-untagged",
        bookingAssetId: "s1",
        quantity: 2,
      }),
    ]);
  });

  it("covers a ledger event logged in two parts from one row", () => {
    const settlement = settlementOf([
      slice("s1", [row("r-a", "LOCATION", { quantity: 5, out: 5 }, "loc-a")]),
    ]);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, consumed: 5 });

    const match = matchSharesToLogs(settlement.planned, [
      log({
        id: "c-1",
        bookingAssetId: "s1",
        category: "CONSUME",
        quantity: 3,
      }),
      log({
        id: "c-2",
        bookingAssetId: "s1",
        category: "CONSUME",
        quantity: 2,
      }),
    ]);

    expect(match.ok && match.shares.map((s) => s.quantity)).toEqual([3, 2]);
  });

  it("covers a ledger event split over two places with both of its rows", () => {
    // Most out first: loc-a (3) settles before loc-b (2).
    const settlement = settlementOf([
      slice("s1", [
        row("r-a", "LOCATION", { quantity: 3, out: 3 }, "loc-a"),
        row("r-b", "LOCATION", { quantity: 2, out: 2 }, "loc-b"),
      ]),
    ]);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, consumed: 5 });

    const match = matchSharesToLogs(settlement.planned, [
      log({
        id: "c-1",
        bookingAssetId: "s1",
        category: "CONSUME",
        quantity: 2,
      }),
      log({
        id: "c-2",
        bookingAssetId: "s1",
        category: "CONSUME",
        quantity: 3,
      }),
    ]);

    // c-2 takes what c-1 left at loc-a, then all of loc-b.
    expect(
      match.ok &&
        match.shares.map((s) => [s.consumptionLogId, s.sourceKey, s.quantity])
    ).toEqual([
      ["c-1", "LOCATION:loc-a", 2],
      ["c-2", "LOCATION:loc-a", 1],
      ["c-2", "LOCATION:loc-b", 2],
    ]);
  });

  it("reports a log nobody settled and units nobody logged", () => {
    const settlement = settlementOf([
      slice("s1", [row("r-a", "UNPLACED", { quantity: 5, out: 5 })]),
    ]);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 2 });

    expect(
      matchSharesToLogs(settlement.planned, [
        log({ id: "c-1", category: "CONSUME", quantity: 1 }),
      ])
    ).toEqual({
      ok: false,
      plannedLeft: [{ assetId: POOL, category: "RETURN", units: 2 }],
      logsLeft: [{ logId: "c-1", units: 1 }],
    });
  });
});

describe("remainingInSettlement", () => {
  it("is zero once every planned unit is settled, whatever was re-dispatched", () => {
    // 10 planned at A: all went out and came back (10 shared), then 5 went
    // out again, so 15 were dispatched over the row's lifetime.
    const rowA = {
      ...row("r-a", "LOCATION", { quantity: 10, out: 5, released: 5 }, "loc-a"),
      dispatchedTotal: 15,
      sharedQuantity: 10,
    };
    const settlement = settlementOf([slice("s1", [rowA])]);

    expect(remainingInSettlement(settlement, POOL)).toBe(5);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 5 });
    expect(remainingInSettlement(settlement, POOL)).toBe(0);
  });

  it("counts pending units that never left as not settled, over every slice", () => {
    const settlement = settlementOf([
      slice("s1", [row("r-1", "UNPLACED", { quantity: 4, out: 0 })]),
      slice("s2", [row("r-2", "KIT", { quantity: 3, out: 3 })], {
        assetKitId: "ak-1",
        mode: "KIT",
      }),
    ]);

    expect(remainingInSettlement(settlement, POOL)).toBe(7);
  });

  it("is null for a LEGACY group", () => {
    const settlement = emptySettlement({
      organizationId: "org-1",
      bookingId: "booking-1",
    });

    expect(remainingInSettlement(settlement, POOL)).toBeNull();
  });
});

describe("slicesUnderLock", () => {
  /** A caller's slice, read before the locks. */
  type Read = { id: string; assetId: string; title: string; fresh: boolean };

  it("walks a converted group's slices as the settlement holds them", () => {
    const settlement = settlementOf([
      slice("s2", [row("r-2", "KIT", { quantity: 3, out: 3 })], {
        assetKitId: "ak-1",
      }),
      slice("s3", [row("r-3", "UNPLACED", { quantity: 2, out: 2 })]),
    ]);
    const read: Read[] = [
      { id: "s1", assetId: POOL, title: "Pens", fresh: false },
      { id: "s2", assetId: POOL, title: "Pens", fresh: false },
      { id: "legacy", assetId: "other", title: "Cups", fresh: false },
    ];

    const walked = slicesUnderLock(
      settlement,
      read,
      (working, found, sibling) =>
        found ?? { ...sibling, id: working.id, fresh: true }
    );

    // s1 was removed before the locks, s3 added: standalone first, then kit.
    expect(walked).toEqual([
      { id: "s3", assetId: POOL, title: "Pens", fresh: true },
      { id: "s2", assetId: POOL, title: "Pens", fresh: false },
      { id: "legacy", assetId: "other", title: "Cups", fresh: false },
    ]);
  });
});

describe("settlementWindow", () => {
  const now = new Date("2026-11-24T10:00:00Z");

  it("is the rest of the booking from now", () => {
    expect(
      settlementWindow(
        {
          from: new Date("2026-11-20T10:00:00Z"),
          to: new Date("2026-11-30T10:00:00Z"),
        },
        now
      )
    ).toEqual({ from: now, to: new Date("2026-11-30T10:00:00Z") });
  });

  it("is a moment at now for an overdue booking", () => {
    expect(
      settlementWindow(
        {
          from: new Date("2026-11-01T10:00:00Z"),
          to: new Date("2026-11-02T10:00:00Z"),
        },
        now
      )
    ).toEqual({ from: now, to: new Date(now.getTime() + 1) });
  });
});
