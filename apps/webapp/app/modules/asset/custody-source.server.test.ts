/**
 * Tests for the placement-change re-home of booking units out and custody.
 *
 * Runs `rehomeCustodyForPlacementChange` and the bulk
 * `rehomeCustodyForPlacementChanges` against an in-memory transaction holding
 * placements, custody, booking slices and source rows. The plan handed to the
 * sources repository is applied to the rows in memory and checked with
 * `sourceRowViolations`, so a move that breaks the reconciliation invariant
 * fails here.
 *
 * @see {@link file://./custody-source.server.ts}
 * @see {@link file://../booking/sources/rehome.server.ts}
 */
import {
  computeShortSlices,
  sourceKey,
  sourceRowViolations,
} from "@shelf/quantity-control";
import type { SourceRowState } from "@shelf/quantity-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourcePlanWrite } from "~/modules/booking/sources/repository.server";

import { planCustodyRehome } from "./custody-source";
import type {
  CustodySourceTxClient,
  LoadedCustodySources,
} from "./custody-source.server";
import {
  loadCustodySourcesForAssets,
  rehomeCustodyForPlacementChange,
  rehomeCustodyForPlacementChanges,
} from "./custody-source.server";

const mocks = vi.hoisted(() => ({
  writeSourcePlan: vi.fn(),
  loadUnitsOutBySource: vi.fn(),
}));

// why: the helpers under test only use the transaction they are handed; the
// root client must never be reached, and importing it would open a connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the repository's writes are proven by its own in-memory tests; here
// the plan it receives is the output under test.
vi.mock("~/modules/booking/sources/repository.server", () => ({
  writeSourcePlan: mocks.writeSourcePlan,
}));

// why: the per-source units-out reader has its own tests over LEGACY logs
// and converted rows; the re-home planner reads booking rows on its own.
vi.mock("~/modules/booking/sources/capacity.server", () => ({
  loadUnitsOutBySource: mocks.loadUnitsOutBySource,
}));

const ORG = "org-1";
const POOL = "pool-1";
const A = "loc-a";
const B = "loc-b";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Prisma-style matching for the filter shapes these helpers send. */
function matches(r: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "booking") {
      return matches((r.booking ?? {}) as Row, cond as Where);
    }
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(r[key]);
      if ("gt" in c) return (r[key] as number) > (c.gt as number);
      return true;
    }
    return (r[key] ?? null) === cond;
  });
}

/** A source row with its share sum (`shared`, the history by default). */
type SourceRow = SourceRowState & {
  id: string;
  bookingAssetId: string;
  organizationId: string;
};

/** In-memory tables and the transaction over them. */
function fakeTx(seed: {
  placements: Array<[string, number]>;
  custody?: Row[];
  slices?: Row[];
  rows?: SourceRow[];
}) {
  const tables = {
    assetLocation: seed.placements.map(([locationId, quantity], i) => ({
      id: `al-${i}`,
      assetId: POOL,
      assetKitId: null,
      locationId,
      quantity,
    })) as Row[],
    custody: (seed.custody ?? []) as Row[],
    bookingAsset: (seed.slices ?? []) as Row[],
    bookingAssetSource: (seed.rows ?? []) as Row[],
  };
  const calls: string[] = [];
  const reader = (table: keyof typeof tables) => ({
    findMany: (args: { where?: Where }) => {
      calls.push(`${table}.findMany`);
      return Promise.resolve(
        tables[table]
          .filter((r) => matches(r, args.where))
          .map((r) => ({ ...r }))
      );
    },
  });
  let nextId = 1;
  const tx = {
    assetLocation: reader("assetLocation"),
    bookingAsset: reader("bookingAsset"),
    bookingAssetSource: reader("bookingAssetSource"),
    custody: {
      ...reader("custody"),
      findFirst: (args: { where?: Where }) =>
        Promise.resolve(
          tables.custody.find((r) => matches(r, args.where)) ?? null
        ),
      update: (args: { where: { id: string }; data: Row }) => {
        const r = tables.custody.find((x) => x.id === args.where.id);
        if (!r) throw new Error("no custody row");
        for (const [k, v] of Object.entries(args.data)) {
          if (v !== null && typeof v === "object") {
            const step = v as { increment?: number; decrement?: number };
            r[k] =
              (r[k] as number) + (step.increment ?? 0) - (step.decrement ?? 0);
          } else {
            r[k] = v;
          }
        }
        return Promise.resolve(r);
      },
      delete: (args: { where: { id: string } }) => {
        tables.custody = tables.custody.filter((x) => x.id !== args.where.id);
        return Promise.resolve({});
      },
      create: (args: { data: Row }) => {
        const r = { id: `c-new-${nextId++}`, kitCustodyId: null, ...args.data };
        tables.custody.push(r);
        return Promise.resolve(r);
      },
    },
  };
  return { tx: tx as unknown as CustodySourceTxClient, tables, calls };
}

/** One booking slice of the pool. */
function slice(
  id: string,
  status: string,
  mode: "LEGACY" | "AUTO" | "MANUAL" = "AUTO"
): Row {
  return {
    id,
    assetId: POOL,
    sourceAllocation: mode,
    checkedOutAt:
      status === "ONGOING" ? new Date("2026-11-19T10:00:00Z") : null,
    booking: { status, organizationId: ORG },
  };
}

/** A source row. */
function sourceRow(
  id: string,
  sliceId: string,
  kind: SourceRowState["kind"],
  locationId: string | null,
  c: { q: number; out?: number; rel?: number; d?: number; shared?: number }
): SourceRow {
  const outQuantity = c.out ?? 0;
  const dispatchedTotal = c.d ?? outQuantity;
  return {
    id,
    bookingAssetId: sliceId,
    organizationId: ORG,
    kind,
    locationId,
    quantity: c.q,
    outQuantity,
    releasedQuantity: c.rel ?? 0,
    dispatchedTotal,
    sharedQuantity: c.shared ?? dispatchedTotal - outQuantity,
  };
}

/** A pool state before the change, as `loadCustodySources` reads it. */
function before(
  total: number,
  placements: Array<[string, number]>,
  custody: LoadedCustodySources["rows"] = []
): LoadedCustodySources {
  return {
    state: {
      total,
      placements: placements.map(([locationId, quantity]) => ({
        locationId,
        quantity,
      })),
      operatorCustody: custody,
    },
    rows: custody,
  };
}

/** The plan the repository received, applied to the rows, each checked. */
function applyAndCheck(rows: SourceRow[], plan: SourcePlanWrite) {
  const model = new Map(
    rows.map((r) => [`${r.bookingAssetId}|${sourceKey(r)}`, { ...r }])
  );
  for (const u of plan.upsertRows) {
    const k = `${u.bookingAssetId}|${sourceKey(u)}`;
    const current = model.get(k);
    model.set(k, {
      ...u,
      id: current?.id ?? `new-${k}`,
      organizationId: ORG,
      sharedQuantity: current?.sharedQuantity ?? 0,
    });
  }
  const after = [...model.values()];
  for (const r of after) {
    expect({ key: sourceKey(r), v: sourceRowViolations(r) }).toEqual({
      key: sourceKey(r),
      v: [],
    });
  }
  return after;
}

/** Counters of a row, for comparison. */
function counters(r: SourceRowState | undefined) {
  return r
    ? {
        quantity: r.quantity,
        outQuantity: r.outQuantity,
        releasedQuantity: r.releasedQuantity,
        dispatchedTotal: r.dispatchedTotal,
      }
    : undefined;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadUnitsOutBySource.mockResolvedValue(new Map());
  mocks.writeSourcePlan.mockResolvedValue(undefined);
});

describe("rehomeCustodyForPlacementChange: booking units out", () => {
  /** 10 dispatched from A, 4 returned (4 units of shares), 6 still out. */
  const returnedFour = () =>
    sourceRow("r-a", "s1", "LOCATION", A, { q: 10, out: 6, rel: 4, d: 10 });

  it("Return 4 of 10, rehome the remaining 6 to B: A out 0, B out 6, invariants hold, logs unchanged", async () => {
    const atA = returnedFour();
    const { tx } = fakeTx({
      // After the change: A's 10 units moved to B.
      placements: [[B, 10]],
      slices: [slice("s1", "ONGOING")],
      rows: [atA],
    });

    const result = await rehomeCustodyForPlacementChange(tx, {
      assetId: POOL,
      total: 10,
      before: before(10, [[A, 10]]),
      destinationLocationId: B,
    });

    expect(result.bookingMoves).toEqual([
      {
        sourceRowId: "r-a",
        sliceId: "s1",
        fromKey: `LOCATION:${A}`,
        toKey: `LOCATION:${B}`,
        units: 6,
      },
    ]);
    expect(result.moves).toEqual([]);
    expect(mocks.writeSourcePlan).toHaveBeenCalledTimes(1);
    const { organizationId, plan } = mocks.writeSourcePlan.mock.calls[0][1] as {
      organizationId: string;
      plan: SourcePlanWrite;
    };
    expect(organizationId).toBe(ORG);
    // Logs unchanged: no share is written or moved, only counters.
    expect(plan.insertShares).toEqual([]);
    expect(plan.repointShares).toEqual([]);
    expect(plan.deleteRowIds).toEqual([]);

    const after = applyAndCheck([atA], plan);
    const at = (key: string) =>
      after.find((r) => r.bookingAssetId === "s1" && sourceKey(r) === key);
    expect(counters(at(`LOCATION:${A}`))).toEqual({
      quantity: 4,
      outQuantity: 0,
      releasedQuantity: 4,
      dispatchedTotal: 4,
    });
    expect(at(`LOCATION:${A}`)?.sharedQuantity).toBe(4);
    expect(counters(at(`LOCATION:${B}`))).toEqual({
      quantity: 6,
      outQuantity: 6,
      releasedQuantity: 0,
      dispatchedTotal: 6,
    });
  });

  it("moves out units to Unknown when no source has room for them", async () => {
    const atA = sourceRow("r-a", "s1", "LOCATION", A, { q: 6, out: 6 });
    const { tx } = fakeTx({
      // A removed, the units left the pool's placements; B is full of custody.
      placements: [[B, 10]],
      custody: [
        {
          id: "c-1",
          assetId: POOL,
          teamMemberId: "tm-1",
          locationId: B,
          sourceUnknown: false,
          quantity: 10,
          createdAt: new Date("2026-11-01"),
          kitCustodyId: null,
        },
      ],
      slices: [slice("s1", "ONGOING")],
      rows: [atA],
    });

    const result = await rehomeCustodyForPlacementChange(tx, {
      assetId: POOL,
      total: 10,
      before: before(16, [
        [A, 6],
        [B, 10],
      ]),
      destinationLocationId: B,
    });

    expect(result.bookingMoves).toEqual([
      expect.objectContaining({ toKey: "UNKNOWN:", units: 6 }),
    ]);
    const { plan } = mocks.writeSourcePlan.mock.calls[0][1] as {
      plan: SourcePlanWrite;
    };
    applyAndCheck([atA], plan);
  });

  it("A manual placement reduced to 0 while pending units are held there: the row stays, the slice is short", async () => {
    const pendingAtA = sourceRow("r-a", "s1", "LOCATION", A, { q: 5 });
    const { tx, calls } = fakeTx({
      placements: [],
      slices: [slice("s1", "RESERVED")],
      rows: [pendingAtA],
    });

    const result = await rehomeCustodyForPlacementChange(tx, {
      assetId: POOL,
      total: 10,
      before: before(10, [[A, 10]]),
      destinationLocationId: null,
    });

    // Pending holds never move with stock: nothing is written.
    expect(result).toEqual({ moves: [], multiSource: false });
    expect(mocks.writeSourcePlan).not.toHaveBeenCalled();
    expect(calls).not.toContain("bookingAssetSource.findMany");

    // The kept row is short at A, which has nothing left.
    const shortages = computeShortSlices({
      capacityBySource: new Map([
        [`LOCATION:${A}`, 0],
        ["UNPLACED:", 10],
      ]),
      holds: [
        {
          sliceId: "s1",
          sourceKey: `LOCATION:${A}`,
          bookingFrom: new Date("2026-11-25"),
          bookingCreatedAt: new Date("2026-11-01"),
          bookingId: "b-1",
          from: new Date("2026-11-25"),
          to: new Date("2026-11-26"),
          out: pendingAtA.outQuantity,
          pending: pendingAtA.quantity,
        },
      ],
      unassignedPendingBySlice: new Map(),
    });
    expect(shortages).toEqual([
      { sliceId: "s1", sourceKey: `LOCATION:${A}`, shortBy: 5 },
    ]);
  });

  it("Custody-only placement changes: output identical to today's planCustodyRehome, one probe and no source read", async () => {
    const custody = [
      {
        id: "c-1",
        teamMemberId: "tm-1",
        locationId: A,
        sourceUnknown: false,
        quantity: 3,
        createdAt: new Date("2026-11-01"),
      },
    ];
    const { tx, calls, tables } = fakeTx({
      placements: [],
      custody: custody.map((c) => ({
        ...c,
        assetId: POOL,
        kitCustodyId: null,
      })),
      // A LEGACY slice out on the pool occupies no source row.
      slices: [slice("s-legacy", "ONGOING", "LEGACY")],
    });
    const beforeState = before(10, [[A, 10]], custody);

    const result = await rehomeCustodyForPlacementChange(tx, {
      assetId: POOL,
      total: 10,
      before: beforeState,
    });

    expect(result.moves).toEqual(
      planCustodyRehome({
        before: beforeState.state,
        after: { total: 10, placements: [], operatorCustody: custody },
        rows: custody,
      })
    );
    expect(result.bookingMoves).toEqual([]);
    expect(tables.custody).toEqual([
      expect.objectContaining({ id: "c-1", locationId: null, quantity: 3 }),
    ]);
    expect(calls.filter((c) => c === "bookingAsset.findMany")).toHaveLength(1);
    expect(calls).not.toContain("bookingAssetSource.findMany");
    expect(mocks.writeSourcePlan).not.toHaveBeenCalled();
  });
});

describe("rehomeCustodyForPlacementChanges (bulk)", () => {
  it("re-homes a pool with booking units out and no custody", async () => {
    const atA = sourceRow("r-a", "s1", "LOCATION", A, {
      q: 10,
      out: 6,
      rel: 4,
      d: 10,
    });
    const { tx, tables } = fakeTx({
      placements: [[A, 10]],
      slices: [slice("s1", "ONGOING")],
      rows: [atA],
    });

    const custodyBefore = await loadCustodySourcesForAssets(tx, [
      { id: POOL, total: 10 },
    ]);
    expect(custodyBefore.get(POOL)?.bookingOut?.rows).toHaveLength(1);

    // The placement write: A's units move to B.
    tables.assetLocation = [
      {
        id: "al-b",
        assetId: POOL,
        assetKitId: null,
        locationId: B,
        quantity: 10,
      },
    ];

    const results = await rehomeCustodyForPlacementChanges(tx, {
      before: custodyBefore,
      totals: new Map([[POOL, 10]]),
      destinationFor: () => B,
    });

    expect(results).toHaveLength(1);
    expect(results[0].result.bookingMoves).toEqual([
      expect.objectContaining({ toKey: `LOCATION:${B}`, units: 6 }),
    ]);
    const { plan } = mocks.writeSourcePlan.mock.calls[0][1] as {
      plan: SourcePlanWrite;
    };
    const after = applyAndCheck([atA], plan);
    expect(
      after.find((r) => sourceKey(r) === `LOCATION:${B}`)?.outQuantity
    ).toBe(6);
  });

  it("returns no pool when nothing is in custody or out on a converted booking", async () => {
    const { tx } = fakeTx({
      placements: [[A, 10]],
      slices: [slice("s1", "RESERVED")],
    });
    const custodyBefore = await loadCustodySourcesForAssets(tx, [
      { id: POOL, total: 10 },
    ]);
    expect(custodyBefore.size).toBe(0);
  });
});
