/**
 * `ensureGroupsConverted`: the adoption flag, the held-back gate, the lock
 * before every deciding read, and voluntary versus involuntary allocation of
 * the pending units conversion leaves.
 *
 * The transaction is a small fake: its `$queryRaw` answers the real asset
 * lock statement and records when it ran. The repository and capacity
 * readers are replaced by recording fakes; their own query behaviour is
 * proven against an in-memory database in their test files, so here only
 * what conversion decides from their answers is observed.
 *
 * @see {@link file://./conversion.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import type { BookingSourcesTx } from "./conversion.server";
import { ensureGroupsConverted } from "./conversion.server";
import type * as RepositoryModule from "./repository.server";
import type { GroupState, SourcePlanWrite } from "./repository.server";

const h = vi.hoisted(() => ({
  order: [] as string[],
  states: new Map<string, unknown>(),
  free: [] as unknown[],
  writes: [] as unknown[],
  info: vi.fn(),
}));

// why: conversion only uses the transaction it is handed; importing the real
// root client would open a connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the repository's reads and writes are proven against an in-memory
// database in repository.server.test.ts; here they record call order and
// hand back fixed group states so conversion's decisions are observable.
vi.mock("./repository.server", async (importOriginal) => {
  const actual = await importOriginal<typeof RepositoryModule>();
  return {
    ...actual,
    loadGroupStates: vi.fn(() => {
      h.order.push("loadGroupStates");
      return h.states;
    }),
    writeSourcePlan: vi.fn((_tx: unknown, args: { plan: SourcePlanWrite }) => {
      h.order.push("writeSourcePlan");
      h.writes.push(args.plan);
    }),
  };
});

// why: free units per source are computed and tested in
// capacity.server.test.ts; a fixed answer isolates the allocation decision.
vi.mock("./capacity.server", () => ({
  computeFreeBySourceForPools: vi.fn(
    (_tx: unknown, args: { assetIds: string[] }) => {
      h.order.push("computeFreeBySourceForPools");
      return new Map(args.assetIds.map((id) => [id, h.free]));
    }
  ),
}));

// why: the held-back report must carry the raw numbers; the spy reads them
// without writing log lines during tests.
vi.mock("~/utils/logger", () => ({ Logger: { info: h.info } }));

const ORG = "org-1";
const BOOKING = "booking-1";
const POOL = "pool-1";
const WINDOW = {
  from: new Date("2026-12-01T09:00:00Z"),
  to: new Date("2026-12-02T09:00:00Z"),
};

/** A fake transaction whose `$queryRaw` answers the asset lock. */
function fakeTx(type: "QUANTITY_TRACKED" | "INDIVIDUAL" = "QUANTITY_TRACKED") {
  return {
    $queryRaw: vi.fn(() => {
      h.order.push("lock");
      return [{ id: POOL, type, quantity: 20 }];
    }),
    location: {
      findMany: vi.fn(() => [{ id: "loc-a", name: "Demo Warehouse" }]),
    },
  } as unknown as BookingSourcesTx;
}

/** One slice as `loadGroupStates` returns it. */
function slice(
  overrides: Partial<GroupState["slices"][number]> & { id: string }
): GroupState["slices"][number] {
  return {
    quantity: 10,
    checkedOutQuantity: 0,
    assetKitId: null,
    sourceLocationId: null,
    recordedSourceIsUnplaced: false,
    mode: "LEGACY",
    rows: [],
    ...overrides,
  };
}

/** Seeds the one group the tests read. */
function seedGroup(state: Partial<GroupState>) {
  h.states = new Map([
    [
      `${BOOKING}:${POOL}`,
      {
        key: { bookingId: BOOKING, assetId: POOL },
        converted: false,
        slices: [],
        logs: [],
        ...state,
      },
    ],
  ]);
}

/** The single plan the call wrote. */
function writtenPlan(): SourcePlanWrite {
  expect(h.writes).toHaveLength(1);
  return h.writes[0] as SourcePlanWrite;
}

const GROUPS = [{ bookingId: BOOKING, assetId: POOL }];

beforeEach(() => {
  h.order = [];
  h.writes = [];
  h.free = [{ kind: "UNPLACED", locationId: null, free: 20, createdOrder: -1 }];
  h.info.mockClear();
});

describe("ensureGroupsConverted", () => {
  it("leaves a LEGACY group alone when adoption is off", async () => {
    seedGroup({ slices: [slice({ id: "s1" })] });

    const result = await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: false,
      transition: "voluntary",
      window: WINDOW,
    });

    expect(result.get(`${BOOKING}:${POOL}`)).toBe("legacy");
    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual([]);
    expect(plan.setModes).toEqual([]);
  });

  it("keeps maintaining a converted group with adoption off: a LEGACY slice in it becomes AUTO", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          rows: [
            {
              id: "r1",
              organizationId: ORG,
              bookingAssetId: "s1",
              kind: "UNPLACED",
              locationId: null,
              quantity: 10,
              outQuantity: 0,
              releasedQuantity: 0,
              dispatchedTotal: 0,
              sharedQuantity: 0,
            },
          ],
        }),
        slice({ id: "s2", quantity: 4 }),
      ],
    });

    const result = await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: false,
      transition: "voluntary",
      window: WINDOW,
    });

    expect(result.get(`${BOOKING}:${POOL}`)).toBe("converted");
    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s2", mode: "AUTO" }]);
    expect(plan.upsertRows).toEqual([
      expect.objectContaining({
        bookingAssetId: "s2",
        kind: "UNPLACED",
        quantity: 4,
      }),
    ]);
  });

  it("holds back a group whose out units do not fit its plan, writes nothing and logs Q, D and S", async () => {
    seedGroup({
      slices: [slice({ id: "s1", quantity: 5, checkedOutQuantity: 10 })],
    });

    const result = await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "involuntary",
      window: WINDOW,
    });

    expect(result.get(`${BOOKING}:${POOL}`)).toBe("held_back");
    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual([]);
    expect(plan.insertShares).toEqual([]);
    expect(plan.setModes).toEqual([]);
    expect(h.info).toHaveBeenCalledTimes(1);
    const details = h.info.mock.calls[0][1] as { slices: string };
    expect(JSON.parse(details.slices)).toEqual([
      { id: "s1", Q: 5, D: 10, S: 0 },
    ]);
  });

  it("takes the asset lock before every read that decides conversion", async () => {
    seedGroup({ slices: [slice({ id: "s1" })] });

    await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "voluntary",
      window: WINDOW,
    });

    expect(h.order).toEqual([
      "lock",
      "loadGroupStates",
      "computeFreeBySourceForPools",
      "writeSourcePlan",
    ]);
  });

  it("converts a LEGACY group and allocates its pending units by the rule", async () => {
    seedGroup({ slices: [slice({ id: "s1", quantity: 6 })] });

    const result = await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "voluntary",
      window: WINDOW,
    });

    expect(result.get(`${BOOKING}:${POOL}`)).toBe("converted");
    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "AUTO" }]);
    expect(plan.upsertRows).toContainEqual(
      expect.objectContaining({ kind: "UNPLACED", quantity: 6 })
    );
  });

  it("puts what fits nowhere on UNASSIGNED at a check-in, never refusing", async () => {
    h.free = [
      { kind: "UNPLACED", locationId: null, free: 1, createdOrder: -1 },
      { kind: "LOCATION", locationId: "loc-a", free: 2, createdOrder: 0 },
    ];
    seedGroup({ slices: [slice({ id: "s1", quantity: 6 })] });

    await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "involuntary",
      window: WINDOW,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows).toContainEqual(
      expect.objectContaining({ kind: "UNASSIGNED", quantity: 3 })
    );
  });

  it("refuses a voluntary conversion that does not fit, naming each source's free units, before any write", async () => {
    h.free = [
      { kind: "UNPLACED", locationId: null, free: 1, createdOrder: -1 },
      { kind: "LOCATION", locationId: "loc-a", free: 2, createdOrder: 0 },
    ];
    seedGroup({ slices: [slice({ id: "s1", quantity: 6 })] });

    const error = await ensureGroupsConverted(fakeTx(), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "voluntary",
      window: WINDOW,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShelfError);
    expect((error as ShelfError).status).toBe(400);
    expect((error as ShelfError).shouldBeCaptured).toBe(false);
    expect((error as ShelfError).message).toBe(
      "Not enough units at Demo Warehouse (2 free) and Unplaced (1 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("skips assets that are not quantity-tracked", async () => {
    seedGroup({ slices: [slice({ id: "s1" })] });

    const result = await ensureGroupsConverted(fakeTx("INDIVIDUAL"), {
      organizationId: ORG,
      groups: GROUPS,
      adoptionEnabled: true,
      transition: "voluntary",
      window: WINDOW,
    });

    expect(result.get(`${BOOKING}:${POOL}`)).toBe("legacy");
    expect(h.order).not.toContain("loadGroupStates");
  });
});
