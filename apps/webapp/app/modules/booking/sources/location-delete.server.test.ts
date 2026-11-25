/**
 * Tests for the location delete evacuation of booking source rows.
 *
 * The pure steps (free units after the delete, the plan built from the
 * planner's writes) run without mocks; every plan is applied to the rows in
 * memory and each resulting row is checked with `sourceRowViolations`, so a
 * plan that breaks a kind rule or the reconciliation invariant fails here.
 * `evacuateLocationsForDelete` runs against a small in-memory transaction.
 *
 * @see {@link file://./location-delete.server.ts}
 */
import { sourceKey, sourceRowViolations } from "@shelf/quantity-control";
import type { SourceHold, SourceRowState } from "@shelf/quantity-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import type { LocationDeleteTx, PersistedRow } from "./location-delete.server";
import {
  buildEvacuationPlan,
  evacuateLocationsForDelete,
  freeAfterDelete,
  sliceEvacuationWindow,
} from "./location-delete.server";
import type { EvacuationRow } from "./rehome";
import { planLocationDeleteEvacuation } from "./rehome";
import type { SourcePlanWrite } from "./repository.server";

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  writeSourcePlan: vi.fn(),
  loadSourceCapacity: vi.fn(),
  loadCompetingHoldsByPool: vi.fn(),
  loadPhysicalNow: vi.fn(),
}));

// why: evacuation only uses the transaction it is handed; the root client
// must never be reached, and importing the real one would open a connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the real lock is a raw `SELECT ... FOR UPDATE`; the fake transaction
// cannot run it, and the tests assert which assets it was asked to lock.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetsForQuantityUpdate: mocks.lock,
}));

// why: the capacity readers have their own tests over placements, custody
// and holds; here each test states the numbers they return.
vi.mock("./capacity.server", () => ({
  loadSourceCapacity: mocks.loadSourceCapacity,
  loadCompetingHoldsByPool: mocks.loadCompetingHoldsByPool,
  loadPhysicalNow: mocks.loadPhysicalNow,
}));

// why: the repository's writes are proven by its own in-memory tests; here
// the plan it receives is the output under test, applied to the fake table.
vi.mock("./repository.server", () => ({
  writeSourcePlan: mocks.writeSourcePlan,
}));

const ORG = "org-1";
const A = "loc-a";
const B = "loc-b";
const C = "loc-c";
const NOW = new Date("2026-11-20T10:00:00Z");
const UNKNOWN_KEY = "UNKNOWN:";
const UNPLACED_KEY = "UNPLACED:";
const UNASSIGNED_KEY = "UNASSIGNED:";

/** A row with its share sum, as the in-memory model keeps it. */
type ModelRow = PersistedRow & { sharedQuantity: number };

/** A persisted row; `shared` defaults to the row's history (the invariant). */
function row(
  id: string,
  sliceId: string,
  kind: SourceRowState["kind"],
  locationId: string | null,
  counters: { q: number; out?: number; rel?: number; d?: number },
  shared?: number
): ModelRow {
  const outQuantity = counters.out ?? 0;
  const dispatchedTotal = counters.d ?? outQuantity;
  return {
    id,
    bookingAssetId: sliceId,
    kind,
    locationId,
    quantity: counters.q,
    outQuantity,
    releasedQuantity: counters.rel ?? 0,
    dispatchedTotal,
    sharedQuantity: shared ?? dispatchedTotal - outQuantity,
  };
}

/** A row at a deleted location as the planner reads it. */
function origin(
  r: ModelRow,
  mode: "AUTO" | "MANUAL",
  checkedOutAt: Date | null = new Date("2026-11-19T10:00:00Z")
): EvacuationRow {
  return {
    ...r,
    sliceId: r.bookingAssetId,
    mode,
    sliceCheckedOutAt: checkedOutAt,
  };
}

/**
 * Applies a repository plan to rows in memory: upserts overwrite counters by
 * slice and key, share moves carry the share sum, deletes must hit removable
 * rows. Returns the rows left.
 */
function applyPlan(rows: ModelRow[], plan: SourcePlanWrite): ModelRow[] {
  const model = new Map<string, ModelRow>(
    rows.map((r) => [`${r.bookingAssetId}|${sourceKey(r)}`, { ...r }])
  );
  const byId = () => [...model.values()];
  let created = 0;
  for (const u of plan.upsertRows) {
    const k = `${u.bookingAssetId}|${sourceKey(u)}`;
    const current = model.get(k);
    model.set(k, {
      ...u,
      id: current?.id ?? `new-${++created}`,
      sharedQuantity: current?.sharedQuantity ?? 0,
    });
  }
  for (const r of plan.repointShares) {
    const from = byId().find((x) => x.id === r.fromRowId);
    if (!from) throw new Error(`no row ${r.fromRowId}`);
    const moved = from.sharedQuantity;
    from.sharedQuantity = 0;
    const to = model.get(`${r.toBookingAssetId}|${r.toKey}`);
    if (!to) throw new Error(`no target ${r.toKey}`);
    to.sharedQuantity += moved;
  }
  for (const id of plan.deleteRowIds) {
    const gone = byId().find((x) => x.id === id);
    if (!gone) throw new Error(`no row ${id}`);
    expect(
      gone.quantity +
        gone.outQuantity +
        gone.releasedQuantity +
        gone.dispatchedTotal +
        gone.sharedQuantity
    ).toBe(0);
    model.delete(`${gone.bookingAssetId}|${sourceKey(gone)}`);
  }
  return byId();
}

/** Asserts every row keeps its kind rules and the reconciliation invariant. */
function expectValidRows(rows: ModelRow[]) {
  for (const r of rows) {
    expect({ key: sourceKey(r), violations: sourceRowViolations(r) }).toEqual({
      key: sourceKey(r),
      violations: [],
    });
  }
}

/** The row of a slice at a key, without its id. */
function find(rows: ModelRow[], sliceId: string, key: string) {
  const r = rows.find(
    (x) => x.bookingAssetId === sliceId && sourceKey(x) === key
  );
  if (!r) return undefined;
  const { id: _id, ...rest } = r;
  return rest;
}

describe("freeAfterDelete", () => {
  it("adds a deleted location's capacity to the unplaced units and leaves it out", () => {
    const free = freeAfterDelete({
      capacity: new Map([
        [UNPLACED_KEY, 4],
        [`LOCATION:${A}`, 10],
        [`LOCATION:${B}`, 6],
      ]),
      holds: [],
      deletedLocationIds: new Set([A]),
      window: { from: NOW, to: new Date("2026-11-21T10:00:00Z") },
    });
    expect(free).toEqual([
      { kind: "UNPLACED", locationId: null, free: 14, createdOrder: -1 },
      { kind: "LOCATION", locationId: B, free: 6, createdOrder: 0 },
    ]);
  });

  it("takes the peak of holds overlapping the slice's window off each source", () => {
    const hold = (from: string, to: string, pending: number): SourceHold => ({
      sliceId: `s-${from}`,
      sourceKey: `LOCATION:${B}`,
      bookingFrom: new Date(from),
      bookingCreatedAt: new Date(from),
      bookingId: `b-${from}`,
      from: new Date(from),
      to: new Date(to),
      out: 0,
      pending,
    });
    const free = freeAfterDelete({
      capacity: new Map([
        [UNPLACED_KEY, 0],
        [`LOCATION:${B}`, 6],
      ]),
      holds: [
        hold("2026-11-20T12:00:00Z", "2026-11-20T14:00:00Z", 4),
        // Ends exactly when the window starts: no overlap.
        hold("2026-11-19T00:00:00Z", "2026-11-20T10:00:00Z", 5),
      ],
      deletedLocationIds: new Set([A]),
      window: { from: NOW, to: new Date("2026-11-21T10:00:00Z") },
    });
    expect(free[1]).toMatchObject({ locationId: B, free: 2 });
  });

  it("lets nothing compete for a terminal booking", () => {
    expect(
      sliceEvacuationWindow(
        {
          status: "COMPLETE",
          from: new Date("2026-11-01"),
          to: new Date("2026-11-02"),
        },
        NOW
      )
    ).toBeNull();
  });

  it("measures an ongoing booking from now and an overdue one without an end", () => {
    const ongoing = sliceEvacuationWindow(
      {
        status: "ONGOING",
        from: new Date("2026-11-19T00:00:00Z"),
        to: new Date("2026-11-22T00:00:00Z"),
      },
      NOW
    );
    expect(ongoing?.from).toEqual(NOW);
    const overdue = sliceEvacuationWindow(
      {
        status: "OVERDUE",
        from: new Date("2026-11-10T00:00:00Z"),
        to: new Date("2026-11-12T00:00:00Z"),
      },
      NOW
    );
    expect(overdue?.to.getTime()).toBeGreaterThan(
      new Date("2100-01-01").getTime()
    );
  });
});

describe("buildEvacuationPlan", () => {
  /** Plans one pool with A deleted and applies the plan. */
  function evacuate({
    rows,
    origins,
    deleted = [A],
    free,
    unplacedRoomForOut,
  }: {
    rows: ModelRow[];
    origins: EvacuationRow[];
    deleted?: string[];
    free: Map<string, ReturnType<typeof freeAfterDelete>>;
    unplacedRoomForOut: number;
  }) {
    const writes = planLocationDeleteEvacuation({
      deletedLocationIds: deleted,
      rows: origins,
      freeBySlice: free,
      unplacedRoomForOut,
    });
    const plan = buildEvacuationPlan({ rows, origins, writes });
    return { plan, after: applyPlan(rows, plan) };
  }

  it("Delete A where a row has quantity 10, out 4, released 3 (AUTO): out to the planner, pending re-allocated, released to UNASSIGNED, history to UNKNOWN, row gone", () => {
    const atA = row("r-a", "s1", "LOCATION", A, {
      q: 10,
      out: 4,
      rel: 3,
      d: 6,
    });
    const free = new Map([
      [
        "s1",
        [
          {
            kind: "UNPLACED" as const,
            locationId: null,
            free: 14,
            createdOrder: -1,
          },
          {
            kind: "LOCATION" as const,
            locationId: B,
            free: 6,
            createdOrder: 0,
          },
        ],
      ],
    ]);
    const { plan, after } = evacuate({
      rows: [atA],
      origins: [origin(atA, "AUTO")],
      free,
      unplacedRoomForOut: 14,
    });

    expect(plan.deleteRowIds).toEqual(["r-a"]);
    expect(plan.repointShares).toEqual([
      { fromRowId: "r-a", toBookingAssetId: "s1", toKey: UNKNOWN_KEY },
    ]);
    expect(after.some((r) => r.id === "r-a")).toBe(false);
    // 4 out + 3 pending on the unplaced units, which cover both.
    expect(find(after, "s1", UNPLACED_KEY)).toMatchObject({
      quantity: 7,
      outQuantity: 4,
      releasedQuantity: 0,
      dispatchedTotal: 4,
      sharedQuantity: 0,
    });
    expect(find(after, "s1", UNKNOWN_KEY)).toMatchObject({
      quantity: 0,
      outQuantity: 0,
      dispatchedTotal: 2,
      sharedQuantity: 2,
    });
    expect(find(after, "s1", UNASSIGNED_KEY)).toMatchObject({
      quantity: 3,
      releasedQuantity: 3,
    });
    // Check 5: the slice still plans its 10 units.
    expect(after.reduce((sum, r) => sum + r.quantity, 0)).toBe(10);
    expectValidRows(after);
  });

  it("Delete A where a row has quantity 10, out 4, released 3 (MANUAL): pending goes to UNASSIGNED", () => {
    const atA = row("r-a", "s1", "LOCATION", A, {
      q: 10,
      out: 4,
      rel: 3,
      d: 6,
    });
    const { after } = evacuate({
      rows: [atA],
      origins: [origin(atA, "MANUAL")],
      free: new Map(),
      unplacedRoomForOut: 0,
    });
    // No room at the unplaced units: the out units go to UNKNOWN.
    expect(find(after, "s1", UNKNOWN_KEY)).toMatchObject({
      quantity: 4,
      outQuantity: 4,
      dispatchedTotal: 6,
      sharedQuantity: 2,
    });
    expect(find(after, "s1", UNASSIGNED_KEY)).toMatchObject({
      quantity: 6,
      releasedQuantity: 3,
      outQuantity: 0,
    });
    expect(after.reduce((sum, r) => sum + r.quantity, 0)).toBe(10);
    expectValidRows(after);
  });

  it("Delete A where a row is a history-only carrier: history moves to UNKNOWN, row gone", () => {
    const carrier = row("r-a", "s1", "LOCATION", A, { q: 0, d: 10 });
    const elsewhere = row("r-b", "s1", "LOCATION", B, { q: 5 });
    const { plan, after } = evacuate({
      rows: [carrier, elsewhere],
      origins: [origin(carrier, "AUTO")],
      free: new Map(),
      unplacedRoomForOut: 0,
    });
    expect(plan.deleteRowIds).toEqual(["r-a"]);
    expect(find(after, "s1", UNKNOWN_KEY)).toMatchObject({
      quantity: 0,
      outQuantity: 0,
      dispatchedTotal: 10,
      sharedQuantity: 10,
    });
    expect(find(after, "s1", `LOCATION:${B}`)).toMatchObject({ quantity: 5 });
    expectValidRows(after);
  });

  it("Bulk delete A and B, both with history, UNKNOWN and Unplaced rows exist: out units planned once on the aggregate, history on one UNKNOWN row, shares repointed, counters summed once", () => {
    const atA = row("r-a", "s1", "LOCATION", A, { q: 5, out: 3, d: 5 });
    const atB = row("r-b", "s1", "LOCATION", B, { q: 4, out: 4, d: 6 });
    const unknown = row("r-u", "s1", "UNKNOWN", null, { q: 2, out: 2, d: 2 });
    const unplaced = row("r-p", "s1", "UNPLACED", null, { q: 1, out: 1, d: 1 });
    const rows = [atA, atB, unknown, unplaced];
    const { plan, after } = evacuate({
      rows,
      origins: [origin(atA, "AUTO"), origin(atB, "AUTO")],
      deleted: [A, B],
      free: new Map([
        [
          "s1",
          [
            {
              kind: "UNPLACED" as const,
              locationId: null,
              free: 20,
              createdOrder: -1,
            },
            {
              kind: "LOCATION" as const,
              locationId: C,
              free: 5,
              createdOrder: 0,
            },
          ],
        ],
      ]),
      // Room for 5 of the 7 units out: the rest goes to UNKNOWN.
      unplacedRoomForOut: 5,
    });

    // One write per target row.
    const keys = plan.upsertRows.map(
      (u) => `${u.bookingAssetId}|${sourceKey(u)}`
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.deleteRowIds.sort()).toEqual(["r-a", "r-b"]);
    expect(plan.repointShares).toHaveLength(2);
    expect(new Set(plan.repointShares.map((r) => r.toKey))).toEqual(
      new Set([UNKNOWN_KEY])
    );

    const unplacedAfter = find(after, "s1", UNPLACED_KEY);
    const unknownAfter = find(after, "s1", UNKNOWN_KEY);
    // Out units: 1 already unplaced + 5 moved; 2 already unknown + 2 moved.
    expect(unplacedAfter?.outQuantity).toBe(6);
    expect(unknownAfter?.outQuantity).toBe(4);
    // History of both rows (2 + 2) on the one UNKNOWN row, with its shares.
    expect(unknownAfter).toMatchObject({
      quantity: 4,
      dispatchedTotal: 8,
      sharedQuantity: 4,
    });
    // Pending: A had 2, B had 0, re-allocated to the unplaced units.
    expect(unplacedAfter?.quantity).toBe(8);
    expect(after.reduce((sum, r) => sum + r.quantity, 0)).toBe(12);
    expect(after.reduce((sum, r) => sum + r.dispatchedTotal, 0)).toBe(14);
    expectValidRows(after);
  });

  it("Location delete moves two shares of one log into one UNKNOWN row: counters and shares consistent", () => {
    // Two rows of one slice at deleted locations, each holding part of the
    // same log's history.
    const atA = row("r-a", "s1", "LOCATION", A, { q: 3, d: 3, rel: 3 });
    const atB = row("r-b", "s1", "LOCATION", B, { q: 2, d: 2, rel: 2 });
    const { after } = evacuate({
      rows: [atA, atB],
      origins: [origin(atA, "AUTO"), origin(atB, "AUTO")],
      deleted: [A, B],
      free: new Map(),
      unplacedRoomForOut: 0,
    });
    expect(find(after, "s1", UNKNOWN_KEY)).toMatchObject({
      quantity: 0,
      dispatchedTotal: 5,
      sharedQuantity: 5,
    });
    expect(find(after, "s1", UNASSIGNED_KEY)).toMatchObject({
      quantity: 5,
      releasedQuantity: 5,
    });
    expectValidRows(after);
  });

  it("keeps an empty UNASSIGNED carrier for a slice whose only row is an all-zero row at the deleted location", () => {
    const empty = row("r-a", "s1", "LOCATION", A, { q: 0 });
    const { plan, after } = evacuate({
      rows: [empty],
      origins: [origin(empty, "AUTO")],
      free: new Map(),
      unplacedRoomForOut: 0,
    });
    expect(plan.deleteRowIds).toEqual(["r-a"]);
    expect(after).toHaveLength(1);
    expect(find(after, "s1", UNASSIGNED_KEY)).toMatchObject({ quantity: 0 });
    expectValidRows(after);
  });
});

/* -------------------------------------------------------------------------- */
/*                         evacuateLocationsForDelete                         */
/* -------------------------------------------------------------------------- */

type Slice = {
  id: string;
  assetId: string;
  bookingId: string;
  checkedOutAt: Date | null;
  sourceAllocation: "LEGACY" | "KIT" | "AUTO" | "MANUAL";
  organizationId: string;
  booking: { status: string; from: Date; to: Date; organizationId: string };
};

type Where = Record<string, unknown>;

/** True when a stored row satisfies the filter shapes evacuation sends. */
function matches(r: Record<string, unknown>, where: Where | undefined) {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "booking") {
      return r.organizationId === (cond as Where).organizationId;
    }
    if (cond !== null && typeof cond === "object" && "in" in cond) {
      return (cond as { in: unknown[] }).in.includes(r[key]);
    }
    return r[key] === cond;
  });
}

/** An in-memory transaction over source rows and slices. */
function fakeTx(seed: { rows: ModelRow[]; slices: Slice[] }) {
  const state = {
    rows: seed.rows.map((r) => ({ ...r, organizationId: ORG })),
    slices: seed.slices,
  };
  const calls: string[] = [];
  const tx = {
    bookingAssetSource: {
      findMany: (args: { where?: Where; take?: number }) => {
        calls.push("bookingAssetSource.findMany");
        const hit = state.rows.filter((r) => matches(r, args.where));
        return Promise.resolve(hit.slice(0, args.take ?? hit.length));
      },
    },
    bookingAsset: {
      findMany: (args: { where?: Where }) => {
        calls.push("bookingAsset.findMany");
        return Promise.resolve(
          state.slices.filter((s) => matches(s, args.where))
        );
      },
    },
  };
  return { tx: tx as unknown as LocationDeleteTx, state, calls };
}

/** One ongoing slice of pool `pool-1`. */
function slice(id: string, mode: Slice["sourceAllocation"] = "AUTO"): Slice {
  return {
    id,
    assetId: "pool-1",
    bookingId: `booking-${id}`,
    checkedOutAt: new Date("2026-11-19T10:00:00Z"),
    sourceAllocation: mode,
    organizationId: ORG,
    booking: {
      status: "ONGOING",
      from: new Date("2026-11-19T00:00:00Z"),
      to: new Date("2026-11-22T00:00:00Z"),
      organizationId: ORG,
    },
  };
}

describe("evacuateLocationsForDelete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lock.mockImplementation((_tx: unknown, ids: string[]) =>
      Promise.resolve(
        [...new Set(ids)].map((id) => ({
          id,
          type: "QUANTITY_TRACKED",
          quantity: 20,
        }))
      )
    );
    mocks.loadSourceCapacity.mockResolvedValue(
      new Map([
        [
          "pool-1",
          new Map([
            [UNPLACED_KEY, 4],
            [`LOCATION:${A}`, 10],
            [`LOCATION:${B}`, 6],
          ]),
        ],
      ])
    );
    mocks.loadCompetingHoldsByPool.mockResolvedValue(new Map());
    mocks.loadPhysicalNow.mockResolvedValue(
      new Map([
        [
          "pool-1",
          new Map([
            [UNPLACED_KEY, 4],
            [`LOCATION:${A}`, 6],
            [`LOCATION:${B}`, 6],
          ]),
        ],
      ])
    );
  });

  it("sends one probe and nothing else when no source row is at the locations", async () => {
    const { tx, calls } = fakeTx({
      rows: [row("r-b", "s1", "LOCATION", B, { q: 5 })],
      slices: [slice("s1")],
    });
    await evacuateLocationsForDelete(tx, {
      organizationId: ORG,
      locationIds: [A],
      now: NOW,
    });
    expect(calls).toEqual(["bookingAssetSource.findMany"]);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.writeSourcePlan).not.toHaveBeenCalled();
  });

  it("locks the pools, moves every part of the rows away and leaves none at the location", async () => {
    const atA = row("r-a", "s1", "LOCATION", A, {
      q: 10,
      out: 4,
      rel: 3,
      d: 6,
    });
    const { tx, state } = fakeTx({ rows: [atA], slices: [slice("s1")] });
    mocks.writeSourcePlan.mockImplementation(
      (
        _tx: unknown,
        args: { organizationId: string; plan: SourcePlanWrite }
      ) => {
        expect(args.organizationId).toBe(ORG);
        state.rows = applyPlan(state.rows, args.plan).map((r) => ({
          ...r,
          organizationId: ORG,
        }));
        return Promise.resolve();
      }
    );

    await evacuateLocationsForDelete(tx, {
      organizationId: ORG,
      locationIds: [A],
      now: NOW,
    });

    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.lock.mock.calls[0][1]).toEqual(["pool-1"]);
    expect(mocks.lock.mock.calls[0][2]).toBe(ORG);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadSourceCapacity.mock.invocationCallOrder[0]
    );
    expect(mocks.writeSourcePlan).toHaveBeenCalledTimes(1);
    expect(state.rows.some((r) => r.locationId === A)).toBe(false);
    expect(state.rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(10);
    expectValidRows(state.rows);
  });

  it("A missed source row at a location being deleted: refuses before the delete", async () => {
    const atA = row("r-a", "s1", "LOCATION", A, { q: 5 });
    const { tx } = fakeTx({ rows: [atA], slices: [slice("s1")] });
    // A writer that leaves the row where it is.
    mocks.writeSourcePlan.mockResolvedValue(undefined);

    const error = await evacuateLocationsForDelete(tx, {
      organizationId: ORG,
      locationIds: [A],
      now: NOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error).toMatchObject({ status: 500 });
  });

  it("asks for a retry when a pool with rows at the location was not locked", async () => {
    const atA = row("r-a", "s1", "LOCATION", A, { q: 5 });
    const { tx } = fakeTx({ rows: [atA], slices: [slice("s1")] });
    mocks.lock.mockResolvedValue([]);

    await expect(
      evacuateLocationsForDelete(tx, {
        organizationId: ORG,
        locationIds: [A],
        now: NOW,
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.writeSourcePlan).not.toHaveBeenCalled();
  });

  it("never reads rows of another workspace", async () => {
    const foreign = { ...row("r-x", "s1", "LOCATION", A, { q: 5 }) };
    const { tx, state, calls } = fakeTx({ rows: [], slices: [slice("s1")] });
    state.rows.push({ ...foreign, organizationId: "org-2" });
    await evacuateLocationsForDelete(tx, {
      organizationId: ORG,
      locationIds: [A],
      now: NOW,
    });
    expect(calls).toEqual(["bookingAssetSource.findMany"]);
  });
});
