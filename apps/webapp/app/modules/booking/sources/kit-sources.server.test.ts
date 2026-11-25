/**
 * Booking sources for kit paths: KIT row resizes on a kit quantity change,
 * and the split of a kit slice's KIT row when the slice loses its kit.
 *
 * The transaction is a small fake answering the module's own reads (the
 * bookings, the KIT rows) and the asset lock statement. The repository and
 * capacity readers are recording fakes; their queries are proven against an
 * in-memory database in their own test files.
 *
 * @see {@link file://./kit-sources.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BookingSourcesTx } from "./conversion.server";
import {
  detachKitSliceSources,
  lockKitDetachPools,
  resizeKitSourceRows,
} from "./kit-sources.server";
import type * as RepositoryModule from "./repository.server";
import type {
  GroupState,
  SourcePlanWrite,
  SourceRowRecord,
  SourceRowWrite,
} from "./repository.server";

const h = vi.hoisted(() => ({
  order: [] as string[],
  states: new Map<string, unknown>(),
  writes: [] as unknown[],
  freeCalls: 0,
  freeUnplaced: 20,
}));

// why: the repository's reads and writes are proven against an in-memory
// database in repository.server.test.ts; here they hand back fixed group
// states and record the plan, so only this module's decisions are observed.
vi.mock("./repository.server", async (importOriginal) => {
  const actual = await importOriginal<typeof RepositoryModule>();
  return {
    ...actual,
    loadGroupStates: vi.fn(() => h.states),
    writeSourcePlan: vi.fn((_tx: unknown, args: { plan: SourcePlanWrite }) => {
      h.writes.push(args.plan);
    }),
  };
});

// why: free units are computed and tested in capacity.server.test.ts; a fixed
// answer (Unplaced only) isolates the allocation of detached pending units.
vi.mock("./capacity.server", () => ({
  computeFreeBySourceForPools: vi.fn(
    (_tx: unknown, args: { assetIds: string[] }) => {
      h.freeCalls += 1;
      return new Map(
        args.assetIds.map((id) => [
          id,
          [
            {
              kind: "UNPLACED",
              locationId: null,
              createdOrder: -1,
              free: h.freeUnplaced,
            },
          ],
        ])
      );
    }
  ),
}));

// why: a held-back group logs; the tests do not need log lines.
vi.mock("~/utils/logger", () => ({ Logger: { info: vi.fn() } }));

const ORG = "org-1";
const BOOKING = "booking-1";
const POOL = "pool-1";
const NOW = new Date("2026-12-01T12:00:00Z");

/** A fake transaction: the lock, the bookings and the KIT rows. */
function fakeTx(
  args: {
    status?: string;
    kitRows?: Array<Partial<SourceRowRecord> & { bookingAssetId: string }>;
    /** Asset ids the detach-lock probe returns. */
    probeAssetIds?: string[];
  } = {}
) {
  return {
    $queryRaw: vi.fn((query: unknown) => {
      if (sqlText(query).includes('FROM "AssetKit"')) {
        h.order.push("probe");
        return args.probeAssetIds?.map((assetId) => ({ assetId })) ?? [];
      }
      h.order.push("lock");
      return [
        { id: POOL, type: "QUANTITY_TRACKED", quantity: 20 },
        { id: "pool-2", type: "QUANTITY_TRACKED", quantity: 20 },
      ];
    }),
    booking: {
      findMany: vi.fn(() => {
        h.order.push("bookings");
        return [
          {
            id: BOOKING,
            organizationId: ORG,
            status: args.status ?? "ONGOING",
            from: new Date("2026-11-30T09:00:00Z"),
            to: new Date("2026-12-05T09:00:00Z"),
          },
        ];
      }),
    },
    bookingAssetSource: {
      findMany: vi.fn(() =>
        (args.kitRows ?? []).map((r) => ({
          id: `${r.bookingAssetId}-KIT`,
          kind: "KIT",
          locationId: null,
          quantity: 0,
          outQuantity: 0,
          releasedQuantity: 0,
          dispatchedTotal: 0,
          ...r,
        }))
      ),
    },
    location: { findMany: vi.fn(() => []) },
  } as unknown as BookingSourcesTx & {
    $queryRaw: ReturnType<typeof vi.fn>;
    booking: { findMany: ReturnType<typeof vi.fn> };
  };
}

/** The text of a raw statement, tagged template or `Prisma.sql`. */
function sqlText(query: unknown): string {
  if (Array.isArray(query)) return query.join("?");
  return (query as { sql: string }).sql;
}

/** A persisted source row. */
function row(
  sliceId: string,
  overrides: Partial<SourceRowRecord>
): SourceRowRecord {
  return {
    id: `${sliceId}-${overrides.kind ?? "UNPLACED"}`,
    organizationId: ORG,
    bookingAssetId: sliceId,
    kind: "UNPLACED",
    locationId: null,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
    sharedQuantity: 0,
    ...overrides,
  };
}

/** One slice as `loadGroupStates` returns it. */
function slice(
  overrides: Partial<GroupState["slices"][number]> & { id: string }
): GroupState["slices"][number] {
  return {
    quantity: 5,
    checkedOutQuantity: 0,
    assetKitId: null,
    sourceLocationId: null,
    recordedSourceIsUnplaced: false,
    mode: "LEGACY",
    rows: [],
    ...overrides,
  };
}

/** Seeds groups of the booking, one per asset. */
function seedGroups(groups: Array<Partial<GroupState> & { assetId?: string }>) {
  h.states = new Map(
    groups.map((g) => {
      const assetId = g.assetId ?? POOL;
      return [
        `${BOOKING}:${assetId}`,
        {
          key: { bookingId: BOOKING, assetId },
          converted: false,
          slices: [],
          logs: [],
          ...g,
        },
      ];
    })
  );
}

/** The single plan the call wrote. */
function writtenPlan(): SourcePlanWrite {
  expect(h.writes).toHaveLength(1);
  return h.writes[0] as SourcePlanWrite;
}

/** The written row of a slice for a kind. */
function upsert(
  plan: SourcePlanWrite,
  sliceId: string,
  kind: string
): SourceRowWrite | undefined {
  return plan.upsertRows.find(
    (r) => r.bookingAssetId === sliceId && r.kind === kind
  );
}

/** A converted kit slice with one KIT row. */
function kitSlice(
  id: string,
  kitRow: Partial<SourceRowRecord>,
  quantity: number
) {
  return slice({
    id,
    quantity,
    checkedOutQuantity: kitRow.dispatchedTotal ?? 0,
    assetKitId: "ak-1",
    mode: "KIT",
    rows: [row(id, { kind: "KIT", quantity, ...kitRow })],
  });
}

beforeEach(() => {
  h.order = [];
  h.states = new Map();
  h.writes = [];
  h.freeCalls = 0;
  h.freeUnplaced = 20;
});

describe("resizeKitSourceRows", () => {
  it("Q 5, D 10, S 10 (out 0, released 5): raise to 6 is allowed and adds one pending unit", async () => {
    const tx = fakeTx({
      kitRows: [
        {
          bookingAssetId: "ba-kit",
          quantity: 5,
          releasedQuantity: 5,
          dispatchedTotal: 10,
        },
      ],
    });

    const result = await resizeKitSourceRows(tx, {
      organizationId: ORG,
      slices: [{ sliceId: "ba-kit", assetId: POOL, quantity: 6 }],
      belowOut: "refuse",
    });

    expect(result.refused).toEqual([]);
    expect(result.quantities.get("ba-kit")).toBe(6);
    expect(writtenPlan().upsertRows).toEqual([
      {
        bookingAssetId: "ba-kit",
        kind: "KIT",
        locationId: null,
        quantity: 6,
        outQuantity: 0,
        releasedQuantity: 5,
        dispatchedTotal: 10,
      },
    ]);
    // The pool is locked before the rows are read.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("lowering back to 5 removes that pending unit, never a released one first", async () => {
    const tx = fakeTx({
      kitRows: [
        {
          bookingAssetId: "ba-kit",
          quantity: 6,
          releasedQuantity: 5,
          dispatchedTotal: 10,
        },
      ],
    });

    await resizeKitSourceRows(tx, {
      organizationId: ORG,
      slices: [{ sliceId: "ba-kit", assetId: POOL, quantity: 5 }],
      belowOut: "refuse",
    });

    expect(upsert(writtenPlan(), "ba-kit", "KIT")).toMatchObject({
      quantity: 5,
      releasedQuantity: 5,
      outQuantity: 0,
    });
  });

  it("refuses a quantity below the units out, naming the floor, and writes nothing", async () => {
    const tx = fakeTx({
      kitRows: [
        {
          bookingAssetId: "ba-kit",
          quantity: 10,
          outQuantity: 6,
          dispatchedTotal: 6,
        },
      ],
    });

    const result = await resizeKitSourceRows(tx, {
      organizationId: ORG,
      slices: [{ sliceId: "ba-kit", assetId: POOL, quantity: 5 }],
      belowOut: "refuse",
    });

    expect(result.refused).toEqual([{ sliceId: "ba-kit", out: 6 }]);
    expect(h.writes).toHaveLength(0);
  });

  it("an involuntary change keeps the units out instead of refusing", async () => {
    const tx = fakeTx({
      kitRows: [
        {
          bookingAssetId: "ba-kit",
          quantity: 10,
          outQuantity: 6,
          dispatchedTotal: 6,
        },
      ],
    });

    const result = await resizeKitSourceRows(tx, {
      organizationId: ORG,
      slices: [{ sliceId: "ba-kit", assetId: POOL, quantity: 5 }],
      belowOut: "clamp",
    });

    expect(result.refused).toEqual([]);
    expect(result.quantities.get("ba-kit")).toBe(6);
    expect(upsert(writtenPlan(), "ba-kit", "KIT")).toMatchObject({
      quantity: 6,
      outQuantity: 6,
    });
  });

  it("sends no query when no converted slice is resized", async () => {
    const tx = fakeTx();

    await resizeKitSourceRows(tx, {
      organizationId: ORG,
      slices: [],
      belowOut: "refuse",
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(h.writes).toHaveLength(0);
  });
});

describe("detachKitSliceSources", () => {
  it("with adoption off and every slice LEGACY, sends no query", async () => {
    const tx = fakeTx();

    const result = await detachKitSliceSources(tx, {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "LEGACY",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(result.convertedSliceIds.size).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.booking.findMany).not.toHaveBeenCalled();
    expect(h.writes).toHaveLength(0);
  });

  it("detach without a collision: AUTO, out and history to UNKNOWN, released to UNASSIGNED, pending allocated", async () => {
    // Q 5: out 2, released 1, pending 2; dispatched 3, 1 unit of shares.
    seedGroups([
      {
        converted: true,
        slices: [
          kitSlice(
            "ba-kit",
            {
              outQuantity: 2,
              releasedQuantity: 1,
              dispatchedTotal: 3,
              sharedQuantity: 1,
            },
            5
          ),
        ],
      },
    ]);
    const tx = fakeTx();

    const result = await detachKitSliceSources(tx, {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    const plan = writtenPlan();
    expect(result.convertedSliceIds).toEqual(new Set(["ba-kit"]));
    expect(plan.setModes).toEqual([{ bookingAssetId: "ba-kit", mode: "AUTO" }]);
    // The KIT row ends empty; the writer drops it once its shares moved.
    expect(upsert(plan, "ba-kit", "KIT")).toMatchObject({
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
    });
    expect(upsert(plan, "ba-kit", "UNKNOWN")).toMatchObject({
      quantity: 2,
      outQuantity: 2,
      releasedQuantity: 0,
      dispatchedTotal: 3,
    });
    expect(upsert(plan, "ba-kit", "UNASSIGNED")).toMatchObject({
      quantity: 1,
      releasedQuantity: 1,
    });
    expect(upsert(plan, "ba-kit", "UNPLACED")).toMatchObject({ quantity: 2 });
    expect(plan.repointShares).toEqual([
      {
        fromRowId: "ba-kit-KIT",
        toBookingAssetId: "ba-kit",
        toKey: "UNKNOWN:",
      },
    ]);
  });

  it("pending units that fit no loose source go to UNASSIGNED, never refused", async () => {
    h.freeUnplaced = 0;
    seedGroups([
      {
        converted: true,
        slices: [kitSlice("ba-kit", { releasedQuantity: 1 }, 3)],
      },
    ]);

    await detachKitSliceSources(fakeTx(), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(upsert(writtenPlan(), "ba-kit", "UNASSIGNED")).toMatchObject({
      quantity: 3,
      releasedQuantity: 1,
    });
  });

  it("kit raised 5 to 10 after two dispatch and return rounds, then detached: 5 pending", async () => {
    // Q 5, D 10, S 10, then raised to 10: KIT row quantity 10, released 5.
    seedGroups([
      {
        converted: true,
        slices: [
          kitSlice(
            "ba-kit",
            {
              releasedQuantity: 5,
              dispatchedTotal: 10,
              sharedQuantity: 10,
            },
            10
          ),
        ],
      },
    ]);

    await detachKitSliceSources(fakeTx(), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    const plan = writtenPlan();
    expect(upsert(plan, "ba-kit", "UNKNOWN")).toMatchObject({
      quantity: 0,
      outQuantity: 0,
      dispatchedTotal: 10,
    });
    expect(upsert(plan, "ba-kit", "UNASSIGNED")).toMatchObject({
      quantity: 5,
      releasedQuantity: 5,
    });
    expect(upsert(plan, "ba-kit", "UNPLACED")).toMatchObject({ quantity: 5 });
  });

  it("detach with a collision merges the parts into the standalone slice", async () => {
    seedGroups([
      {
        converted: true,
        slices: [
          slice({
            id: "ba-standalone",
            quantity: 4,
            mode: "AUTO",
            rows: [row("ba-standalone", { kind: "UNPLACED", quantity: 4 })],
          }),
          kitSlice(
            "ba-kit",
            {
              outQuantity: 2,
              releasedQuantity: 1,
              dispatchedTotal: 3,
              sharedQuantity: 1,
            },
            5
          ),
        ],
      },
    ]);

    const result = await detachKitSliceSources(fakeTx(), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    const plan = writtenPlan();
    expect(result.convertedSliceIds).toEqual(new Set(["ba-kit"]));
    // The kit slice is deleted by the caller's merge; its mode stays.
    expect(plan.setModes).toEqual([]);
    expect(upsert(plan, "ba-standalone", "UNKNOWN")).toMatchObject({
      quantity: 2,
      outQuantity: 2,
      dispatchedTotal: 3,
    });
    expect(upsert(plan, "ba-standalone", "UNASSIGNED")).toMatchObject({
      quantity: 1,
      releasedQuantity: 1,
    });
    // 4 of its own plus the kit slice's 2 pending.
    expect(upsert(plan, "ba-standalone", "UNPLACED")).toMatchObject({
      quantity: 6,
    });
    expect(plan.repointShares).toEqual([
      {
        fromRowId: "ba-kit-KIT",
        toBookingAssetId: "ba-standalone",
        toKey: "UNKNOWN:",
      },
    ]);
    // Every unit of both slices stays planned: 4 + 5.
    const total = plan.upsertRows
      .filter((r) => r.bookingAssetId === "ba-standalone")
      .reduce((sum, r) => sum + r.quantity, 0);
    expect(total).toBe(9);
  });

  it("on a finished booking, pending units go to UNASSIGNED without reading free units", async () => {
    seedGroups([
      {
        converted: true,
        slices: [kitSlice("ba-kit", { outQuantity: 2, dispatchedTotal: 2 }, 5)],
      },
    ]);

    await detachKitSliceSources(fakeTx({ status: "CANCELLED" }), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(h.freeCalls).toBe(0);
    expect(upsert(writtenPlan(), "ba-kit", "UNASSIGNED")).toMatchObject({
      quantity: 3,
      releasedQuantity: 0,
    });
  });

  it("with adoption on, a LEGACY group on an active booking converts and then detaches", async () => {
    seedGroups([
      {
        converted: false,
        slices: [slice({ id: "ba-kit", quantity: 5, assetKitId: "ak-1" })],
      },
    ]);

    const result = await detachKitSliceSources(fakeTx(), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "LEGACY",
        },
      ],
      adoptionEnabled: true,
      now: NOW,
    });

    const plan = writtenPlan();
    expect(result.convertedSliceIds).toEqual(new Set(["ba-kit"]));
    expect(plan.setModes).toEqual([{ bookingAssetId: "ba-kit", mode: "AUTO" }]);
    // The seeded KIT row is never written.
    expect(upsert(plan, "ba-kit", "KIT")).toBeUndefined();
    expect(upsert(plan, "ba-kit", "UNPLACED")).toMatchObject({ quantity: 5 });
  });

  it("with adoption on, a LEGACY slice on a finished booking stays LEGACY", async () => {
    const tx = fakeTx({ status: "COMPLETE" });

    const result = await detachKitSliceSources(tx, {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "LEGACY",
        },
      ],
      adoptionEnabled: true,
      now: NOW,
    });

    expect(result.convertedSliceIds.size).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it("locks the pools before it reads the booking statuses, and reads only the acting workspace", async () => {
    seedGroups([
      {
        converted: true,
        slices: [kitSlice("ba-kit", {}, 2)],
      },
    ]);
    const tx = fakeTx();

    await detachKitSliceSources(tx, {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(h.order.slice(0, 2)).toEqual(["lock", "bookings"]);
    expect(tx.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [BOOKING] }, organizationId: ORG },
      })
    );
  });

  it("a slice whose booking is outside the workspace is left alone", async () => {
    seedGroups([
      {
        converted: true,
        slices: [kitSlice("ba-kit", {}, 2)],
      },
    ]);
    const tx = fakeTx();
    // The workspace-scoped read finds no such booking.
    tx.booking.findMany.mockImplementationOnce(() => []);

    const result = await detachKitSliceSources(tx, {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: "booking-foreign",
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(result.convertedSliceIds.size).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it("a booking this transaction is finishing counts as finished: pending to UNASSIGNED", async () => {
    seedGroups([
      {
        converted: true,
        slices: [kitSlice("ba-kit", { outQuantity: 1, dispatchedTotal: 1 }, 3)],
      },
    ]);

    await detachKitSliceSources(fakeTx({ status: "ONGOING" }), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
      ],
      finishingBookingIds: [BOOKING],
      adoptionEnabled: false,
      now: NOW,
    });

    expect(h.freeCalls).toBe(0);
    const plan = writtenPlan();
    expect(upsert(plan, "ba-kit", "UNASSIGNED")).toMatchObject({
      quantity: 2,
      releasedQuantity: 0,
    });
    expect(upsert(plan, "ba-kit", "UNPLACED")).toBeUndefined();
  });

  it("kit delete: every slice of the kit is split, in one write", async () => {
    seedGroups([
      {
        assetId: POOL,
        converted: true,
        slices: [
          kitSlice("ba-kit-1", { outQuantity: 1, dispatchedTotal: 1 }, 2),
        ],
      },
      {
        assetId: "pool-2",
        converted: true,
        slices: [kitSlice("ba-kit-2", {}, 3)],
      },
    ]);

    const result = await detachKitSliceSources(fakeTx(), {
      organizationId: ORG,
      kitSlices: [
        {
          id: "ba-kit-1",
          bookingId: BOOKING,
          assetId: POOL,
          sourceAllocation: "KIT",
        },
        {
          id: "ba-kit-2",
          bookingId: BOOKING,
          assetId: "pool-2",
          sourceAllocation: "KIT",
        },
      ],
      adoptionEnabled: false,
      now: NOW,
    });

    const plan = writtenPlan();
    expect(result.convertedSliceIds).toEqual(new Set(["ba-kit-1", "ba-kit-2"]));
    expect(plan.setModes).toEqual([
      { bookingAssetId: "ba-kit-1", mode: "AUTO" },
      { bookingAssetId: "ba-kit-2", mode: "AUTO" },
    ]);
    expect(upsert(plan, "ba-kit-1", "UNKNOWN")).toMatchObject({
      quantity: 1,
      outQuantity: 1,
      dispatchedTotal: 1,
    });
    expect(upsert(plan, "ba-kit-2", "UNPLACED")).toMatchObject({ quantity: 3 });
  });
});

describe("lockKitDetachPools", () => {
  it("with adoption off and no converted slice, sends the one probe and takes no lock", async () => {
    const tx = fakeTx({ probeAssetIds: [] });

    const locked = await lockKitDetachPools(tx, {
      organizationId: ORG,
      assetKitIds: ["ak-1"],
      adoptionEnabled: false,
    });

    expect(locked.size).toBe(0);
    expect(h.order).toEqual(["probe"]);
    const probe = tx.$queryRaw.mock.calls[0][0] as {
      sql: string;
      values: unknown[];
    };
    // Scoped to the workspace, gated on a converted slice per membership.
    expect(probe.sql).toContain('ak."organizationId" =');
    expect(probe.sql).toContain(`ba."sourceAllocation" <> 'LEGACY'`);
    expect(probe.values).toContain(ORG);
  });

  it("locks every asset the probe returns in one statement after it", async () => {
    const tx = fakeTx({ probeAssetIds: [POOL, "pool-2"] });

    const locked = await lockKitDetachPools(tx, {
      organizationId: ORG,
      assetKitIds: ["ak-1", "ak-2"],
      adoptionEnabled: false,
    });

    expect(locked).toEqual(new Set([POOL, "pool-2"]));
    expect(h.order).toEqual(["probe", "lock"]);
  });

  it("a foreign membership id matches nothing, so nothing is locked", async () => {
    // The probe filters `AssetKit` by the acting workspace; a foreign id
    // returns no row.
    const tx = fakeTx({ probeAssetIds: [] });

    const locked = await lockKitDetachPools(tx, {
      organizationId: ORG,
      assetKitIds: ["ak-foreign"],
      adoptionEnabled: true,
    });

    expect(locked.size).toBe(0);
    expect(h.order).toEqual(["probe"]);
  });

  it("sends no query for no memberships", async () => {
    const tx = fakeTx();

    await lockKitDetachPools(tx, {
      organizationId: ORG,
      assetKitIds: [],
      adoptionEnabled: true,
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
