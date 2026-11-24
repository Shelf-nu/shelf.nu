/**
 * The booking-sources facade: new slices, resizes, window changes, silent
 * re-allocation of AUTO slices that no longer fit, check-out dispatch, and
 * the display summary.
 *
 * The transaction is a small fake answering the facade's own reads (the
 * touched slices, the booking status, location names) and the real asset
 * lock statement, recording when the lock ran. The repository and capacity
 * readers are replaced by recording fakes; their query behaviour is proven
 * against an in-memory database in their own test files, so here only what
 * the facade decides from their answers is observed.
 *
 * @see {@link file://./booking-sources.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import {
  admitWindowChange,
  allocateNewSlices,
  commitSettlement,
  dispatchUnits,
  getSliceSourceSummaries,
  openSettlement,
  resizeSlices,
  setAutoSources,
  setManualSources,
} from "./booking-sources.server";
import type { BookingSourcesTx } from "./conversion.server";
import type * as RepositoryModule from "./repository.server";
import type {
  GroupState,
  SourcePlanWrite,
  SourceRowRecord,
} from "./repository.server";
import { settleUnits } from "./settlement";

type FreeArgs = { window: { from: Date; to: Date } };

const h = vi.hoisted(() => ({
  order: [] as string[],
  states: new Map<string, unknown>(),
  freeFor: (_args: FreeArgs): unknown[] => [],
  writes: [] as unknown[],
  windows: [] as Array<{ from: Date; to: Date }>,
  db: {} as Record<string, unknown>,
  capacity: new Map<string, Map<string, number>>(),
  holds: new Map<string, unknown[]>(),
  physical: new Map<string, Map<string, number>>(),
}));

// why: the summary reads through the root client; this stand-in answers the
// few reads it makes without opening a connection.
vi.mock("~/database/db.server", () => ({
  get db() {
    return h.db;
  },
}));

// why: the repository's reads and writes are proven against an in-memory
// database in repository.server.test.ts; here they record call order and
// hand back fixed group states so the facade's decisions are observable.
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

// why: free units, capacity and competing holds are computed and tested in
// capacity.server.test.ts; fixed answers isolate the facade's decisions.
vi.mock("./capacity.server", () => ({
  computeFreeBySourceForPools: vi.fn(
    (_tx: unknown, args: FreeArgs & { assetIds: string[] }) => {
      h.order.push("computeFreeBySourceForPools");
      h.windows.push(args.window);
      return new Map(args.assetIds.map((id) => [id, h.freeFor(args)]));
    }
  ),
  loadSourceCapacity: vi.fn(() => h.capacity),
  loadCompetingHoldsByPool: vi.fn(() => h.holds),
  loadPhysicalNow: vi.fn(() => h.physical),
}));

// why: a held-back group logs; the tests do not need log lines.
vi.mock("~/utils/logger", () => ({ Logger: { info: vi.fn() } }));

const ORG = "org-1";
const BOOKING = "booking-1";
const POOL = "pool-1";
const WINDOW = {
  from: new Date("2026-12-01T09:00:00Z"),
  to: new Date("2026-12-02T09:00:00Z"),
};
const UNPLACED_KEY = { kind: "UNPLACED", locationId: null, createdOrder: -1 };
const LOC_A_KEY = { kind: "LOCATION", locationId: "loc-a", createdOrder: 0 };

/** Free units: Unplaced and Demo Warehouse (loc-a). */
function free(unplaced: number, locA: number) {
  return [
    { ...UNPLACED_KEY, free: unplaced },
    { ...LOC_A_KEY, free: locA },
  ];
}

/**
 * A fake transaction: the facade's slice and booking reads, location names,
 * and the asset lock statement (recorded in call order).
 */
function fakeTx(args: {
  slices: Array<{ id: string; assetId?: string }>;
  status?: string;
}) {
  const slices = args.slices.map((s) => ({
    id: s.id,
    assetId: s.assetId ?? POOL,
  }));
  return {
    $queryRaw: vi.fn(() => {
      h.order.push("lock");
      return [{ id: POOL, type: "QUANTITY_TRACKED", quantity: 20 }];
    }),
    bookingAsset: {
      findMany: vi.fn(({ where }: { where: { id?: { in: string[] } } }) =>
        slices.filter((s) => !where.id || where.id.in.includes(s.id))
      ),
    },
    booking: {
      findFirst: vi.fn(() => ({
        status: args.status ?? "RESERVED",
        from: WINDOW.from,
        createdAt: new Date("2026-11-01T09:00:00Z"),
      })),
    },
    location: {
      findMany: vi.fn(() => [
        { id: "loc-a", name: "Demo Warehouse" },
        { id: "loc-b", name: "Back Room" },
      ]),
    },
    asset: { findFirst: vi.fn(() => ({ title: "Cables" })) },
  } as unknown as BookingSourcesTx;
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

/** Runs a call expected to refuse and returns the error. */
async function refusal(call: Promise<void>): Promise<ShelfError> {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ShelfError);
  expect((error as ShelfError).status).toBe(400);
  expect((error as ShelfError).shouldBeCaptured).toBe(false);
  return error as ShelfError;
}

beforeEach(() => {
  h.order = [];
  h.writes = [];
  h.windows = [];
  h.freeFor = () => free(20, 0);
  h.capacity = new Map();
  h.holds = new Map();
  h.physical = new Map();
});

describe("allocateNewSlices", () => {
  it("refuses with each location's free units and writes nothing", async () => {
    h.freeFor = () => free(0, 3);
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    const error = await refusal(
      allocateNewSlices(fakeTx({ slices: [{ id: "s1" }] }), {
        organizationId: ORG,
        bookingId: BOOKING,
        sliceIds: ["s1"],
        window: WINDOW,
        holdsNow: true,
        adoptionEnabled: true,
      })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (3 free) and Unplaced (0 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("refuses when the pool fits but no fixed set of sources covers the whole window", async () => {
    // The pool holds 10. Another booking takes Demo Warehouse's 5 in the
    // first half of the window and Unplaced's 5 in the second half, so the
    // pool-wide peak leaves 5 free while each source's peak over the whole
    // window leaves none: that per-source peak is what free units report.
    h.freeFor = () => free(0, 0);
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    const error = await refusal(
      allocateNewSlices(fakeTx({ slices: [{ id: "s1" }] }), {
        organizationId: ORG,
        bookingId: BOOKING,
        sliceIds: ["s1"],
        window: WINDOW,
        holdsNow: true,
        adoptionEnabled: true,
      })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (0 free) and Unplaced (0 free) for these dates."
    );
  });

  it("takes the asset lock before any read that decides conversion or allocation", async () => {
    seedGroup({ slices: [slice({ id: "s1" })] });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s1"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: true,
    });

    expect(h.order).toEqual([
      "lock",
      "loadGroupStates",
      "computeFreeBySourceForPools",
      "writeSourcePlan",
    ]);
  });

  it("creates a slice added to a converted group AUTO even with adoption off", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          rows: [row("s1", { quantity: 5 })],
        }),
        slice({ id: "s2", quantity: 3 }),
      ],
    });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s2" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s2"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: false,
    });

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s2", mode: "AUTO" }]);
    expect(plan.upsertRows).toEqual([
      expect.objectContaining({
        bookingAssetId: "s2",
        kind: "UNPLACED",
        quantity: 3,
      }),
    ]);
  });

  it("leaves a slice added to a LEGACY group LEGACY when adoption is off", async () => {
    seedGroup({
      slices: [slice({ id: "s1" }), slice({ id: "s2", quantity: 3 })],
    });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s2" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s2"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: false,
    });

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([]);
    expect(plan.upsertRows).toEqual([]);
  });

  it("writes nothing for a held-back group and leaves the slice added with it LEGACY", async () => {
    seedGroup({
      slices: [
        slice({ id: "s1", quantity: 5, checkedOutQuantity: 10 }),
        slice({ id: "s2", quantity: 3 }),
      ],
    });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s2" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s2"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: true,
    });

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([]);
    expect(plan.upsertRows).toEqual([]);
    expect(plan.insertShares).toEqual([]);
  });

  it("silently moves a short AUTO slice to a source that fits on the next call", async () => {
    // Demo Warehouse has 2 free for this booking's 5 pending units there;
    // Unplaced has room for all of them.
    h.freeFor = () => free(10, 2);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
        slice({ id: "s2", quantity: 3, assetKitId: "kit-1" }),
      ],
    });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s2" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s2"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: false,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookingAssetId: "s1",
          kind: "LOCATION",
          quantity: 0,
        }),
        expect.objectContaining({
          bookingAssetId: "s1",
          kind: "UNPLACED",
          quantity: 5,
        }),
        expect.objectContaining({
          bookingAssetId: "s2",
          kind: "KIT",
          quantity: 3,
        }),
      ])
    );
    expect(plan.setModes).toEqual([{ bookingAssetId: "s2", mode: "KIT" }]);
  });

  it("never moves a short MANUAL slice: it stays where the user put it", async () => {
    h.freeFor = () => free(10, 2);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
        slice({ id: "s2", quantity: 3, assetKitId: "kit-1" }),
      ],
    });

    await allocateNewSlices(fakeTx({ slices: [{ id: "s2" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceIds: ["s2"],
      window: WINDOW,
      holdsNow: true,
      adoptionEnabled: false,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows.filter((r) => r.bookingAssetId === "s1")).toEqual(
      []
    );
  });
});

describe("resizeSlices", () => {
  /** A RESERVED or DRAFT booking with one AUTO slice of 5 at Unplaced. */
  function seedAutoSlice() {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          rows: [row("s1", { quantity: 5 })],
        }),
      ],
    });
  }

  it("refuses an increase that does not fit instead of putting pending units on UNASSIGNED", async () => {
    // 6 free at Unplaced excluding this booking, which already holds 5 there.
    h.freeFor = () => free(6, 0);
    seedAutoSlice();

    await refusal(
      resizeSlices(fakeTx({ slices: [{ id: "s1" }] }), {
        organizationId: ORG,
        bookingId: BOOKING,
        changes: [{ sliceId: "s1", quantity: 8 }],
        window: WINDOW,
        adoptionEnabled: true,
      })
    );

    expect(h.writes).toHaveLength(0);
  });

  it("with admit: false, puts an increase on UNASSIGNED for the sources call to place and admit", async () => {
    // Too little free anywhere for the increase: an admitted call refuses.
    h.freeFor = () => free(6, 0);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          rows: [row("s1", { quantity: 5 })],
        }),
      ],
    });

    await resizeSlices(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      changes: [{ sliceId: "s1", quantity: 8 }],
      window: WINDOW,
      adoptionEnabled: true,
      admit: false,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "UNASSIGNED", quantity: 3 }),
      ])
    );
    expect(plan.upsertRows).not.toContainEqual(
      expect.objectContaining({ kind: "UNPLACED", quantity: 8 })
    );
  });

  it("lets a draft grow past its sources, the rest waiting on UNASSIGNED", async () => {
    h.freeFor = () => free(6, 0);
    seedAutoSlice();

    await resizeSlices(fakeTx({ slices: [{ id: "s1" }], status: "DRAFT" }), {
      organizationId: ORG,
      bookingId: BOOKING,
      changes: [{ sliceId: "s1", quantity: 8 }],
      window: WINDOW,
      adoptionEnabled: true,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "UNPLACED", quantity: 6 }),
        expect.objectContaining({ kind: "UNASSIGNED", quantity: 2 }),
      ])
    );
  });

  it("lowers a LEGACY slice that converts now without admitting units it gives up", async () => {
    // Only 6 units fit anywhere; the slice books 10 and is lowered to 5.
    h.freeFor = () => free(6, 0);
    seedGroup({ slices: [slice({ id: "s1", quantity: 10 })] });

    await resizeSlices(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      changes: [{ sliceId: "s1", quantity: 5 }],
      window: WINDOW,
      adoptionEnabled: true,
    });

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "AUTO" }]);
    expect(plan.upsertRows).toContainEqual(
      expect.objectContaining({ kind: "UNPLACED", quantity: 5 })
    );
    expect(
      plan.upsertRows.filter((r) => r.kind === "UNASSIGNED" && r.quantity > 0)
    ).toEqual([]);
  });

  it("lowers a slice from its pending units and refuses to go below out", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          checkedOutQuantity: 3,
          rows: [
            row("s1", { quantity: 5, outQuantity: 3, dispatchedTotal: 3 }),
          ],
        }),
      ],
    });

    const error = await refusal(
      resizeSlices(fakeTx({ slices: [{ id: "s1" }] }), {
        organizationId: ORG,
        bookingId: BOOKING,
        changes: [{ sliceId: "s1", quantity: 2 }],
        window: WINDOW,
        adoptionEnabled: true,
      })
    );
    expect(error.message).toBe(
      "The quantity cannot go below the 3 units already out."
    );
  });
});

describe("admitWindowChange", () => {
  const PREVIOUS = WINDOW;
  const NEW_TO = new Date("2026-12-03T09:00:00Z");
  const NOW = new Date("2026-12-01T12:00:00Z");

  it("refuses an extension when the out units do not fit after the old end", async () => {
    // Over the whole new window Demo Warehouse fits the 5 units out; from the
    // old end onwards another booking leaves only 2.
    h.freeFor = ({ window }) =>
      window.from.getTime() === PREVIOUS.to.getTime() ? free(0, 2) : free(0, 5);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          checkedOutQuantity: 5,
          rows: [
            row("s1", {
              kind: "LOCATION",
              locationId: "loc-a",
              quantity: 5,
              outQuantity: 5,
              dispatchedTotal: 5,
            }),
          ],
        }),
      ],
    });

    const error = await refusal(
      admitWindowChange(fakeTx({ slices: [{ id: "s1" }], status: "ONGOING" }), {
        organizationId: ORG,
        bookingId: BOOKING,
        from: WINDOW.from,
        to: NEW_TO,
        previous: PREVIOUS,
        kind: "extend",
        now: NOW,
        adoptionEnabled: true,
      })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (2 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("moves the pending units of an AUTO slice that no longer fits to a source that does", async () => {
    h.freeFor = () => free(10, 2);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
      ],
    });

    await admitWindowChange(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      from: WINDOW.from,
      to: NEW_TO,
      previous: PREVIOUS,
      kind: "dates",
      adoptionEnabled: true,
    });

    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "UNPLACED", quantity: 5 }),
      ])
    );
  });
  it("measures an overdue extension from now, never from the old end", async () => {
    // The booking ended on Dec 2 and it is now Dec 2 18:00; another booking
    // fills Demo Warehouse in the gap already behind us, which cannot compete.
    const overdueNow = new Date("2026-12-02T18:00:00Z");
    h.freeFor = ({ window }) =>
      window.from.getTime() === overdueNow.getTime() ? free(0, 5) : free(0, 0);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          checkedOutQuantity: 5,
          rows: [
            row("s1", {
              kind: "LOCATION",
              locationId: "loc-a",
              quantity: 5,
              outQuantity: 5,
              dispatchedTotal: 5,
            }),
          ],
        }),
      ],
    });

    await admitWindowChange(
      fakeTx({ slices: [{ id: "s1" }], status: "OVERDUE" }),
      {
        organizationId: ORG,
        bookingId: BOOKING,
        from: WINDOW.from,
        to: NEW_TO,
        previous: PREVIOUS,
        kind: "extend",
        now: overdueNow,
        adoptionEnabled: true,
      }
    );

    expect(h.windows).toEqual([{ from: overdueNow, to: NEW_TO }]);
    expect(h.writes).toHaveLength(1);
  });

  it("places a converting LEGACY group's pending over the whole remaining window on an extension, never refusing", async () => {
    // Demo Warehouse is full between now and the old end but free in the
    // added time; Unplaced has nothing. The legacy pending cannot sit at
    // Demo Warehouse for the whole remaining window, so it waits on
    // UNASSIGNED, and the extension is still admitted.
    const measured = { from: PREVIOUS.to, to: NEW_TO };
    const remaining = { from: NOW, to: NEW_TO };
    h.freeFor = ({ window }) =>
      window.from.getTime() === NOW.getTime() ? free(0, 0) : free(0, 5);
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    await admitWindowChange(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      from: WINDOW.from,
      to: NEW_TO,
      previous: PREVIOUS,
      kind: "extend",
      now: NOW,
      adoptionEnabled: true,
    });

    expect(h.windows).toEqual([measured, remaining]);
    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "AUTO" }]);
    expect(plan.upsertRows).toContainEqual(
      expect.objectContaining({ kind: "UNASSIGNED", quantity: 5 })
    );
    expect(
      plan.upsertRows.filter((r) => r.kind === "LOCATION" && r.quantity > 0)
    ).toEqual([]);
  });

  it("puts a converting LEGACY group's pending on a source that fits the whole remaining window", async () => {
    h.freeFor = ({ window }) =>
      window.from.getTime() === NOW.getTime() ? free(5, 0) : free(5, 5);
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    await admitWindowChange(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      from: WINDOW.from,
      to: NEW_TO,
      previous: PREVIOUS,
      kind: "extend",
      now: NOW,
      adoptionEnabled: true,
    });

    expect(writtenPlan().upsertRows).toContainEqual(
      expect.objectContaining({ kind: "UNPLACED", quantity: 5 })
    );
  });

  it("lets a booking already short from lost stock shorten its dates", async () => {
    // Stock was lost: over the old window Demo Warehouse has 2 free for the
    // 5 this booking holds (3 short); over the shorter window it has 3 free
    // (2 short). The change makes the shortage smaller, so it is admitted.
    const shorterTo = new Date("2026-12-01T18:00:00Z");
    h.freeFor = ({ window }) =>
      window.to.getTime() === shorterTo.getTime() ? free(0, 3) : free(0, 2);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
      ],
    });

    await admitWindowChange(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      from: WINDOW.from,
      to: shorterTo,
      previous: PREVIOUS,
      kind: "dates",
      adoptionEnabled: true,
    });

    expect(h.writes).toHaveLength(1);
  });

  it("refuses new dates that make a shortage worse, with the free units of the new window", async () => {
    h.freeFor = ({ window }) =>
      window.to.getTime() === NEW_TO.getTime() ? free(0, 1) : free(0, 5);
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
      ],
    });

    const error = await refusal(
      admitWindowChange(fakeTx({ slices: [{ id: "s1" }] }), {
        organizationId: ORG,
        bookingId: BOOKING,
        from: WINDOW.from,
        to: NEW_TO,
        previous: PREVIOUS,
        kind: "dates",
        adoptionEnabled: true,
      })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (1 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });
});

describe("setManualSources", () => {
  /** One AUTO slice of 5 at Unplaced, optionally with units out. */
  function seedSlice(out = 0) {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          checkedOutQuantity: out,
          rows: [
            row("s1", { quantity: 5, outQuantity: out, dispatchedTotal: out }),
          ],
        }),
      ],
    });
  }

  /** Calls setManualSources for s1 with the given split. */
  function choose(
    sources: Array<{ locationId: string | null; quantity: number }>,
    status = "RESERVED"
  ) {
    return setManualSources(fakeTx({ slices: [{ id: "s1" }], status }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceId: "s1",
      sources,
      window: WINDOW,
      adoptionEnabled: true,
    });
  }

  beforeEach(() => {
    h.freeFor = () => free(10, 3);
  });

  it("refuses a split that does not add up to the planned units", async () => {
    seedSlice();

    const error = await refusal(
      choose([
        { locationId: null, quantity: 2 },
        { locationId: "loc-a", quantity: 2 },
      ])
    );

    expect(error.message).toBe("The sources must add up to 5 units.");
    expect(h.writes).toHaveLength(0);
  });

  it("refuses to leave a source with fewer units than are out from it", async () => {
    seedSlice(3);

    const error = await refusal(
      choose([
        { locationId: null, quantity: 1 },
        { locationId: "loc-a", quantity: 4 },
      ])
    );

    expect(error.message).toBe(
      "A source cannot have fewer units than are already out from it."
    );
  });

  it("refuses a location that is not a placement of the pool", async () => {
    seedSlice();

    const error = await refusal(choose([{ locationId: "loc-b", quantity: 5 }]));

    expect(error.message).toBe(
      "One of the chosen locations does not hold this asset."
    );
  });

  it("admits only at sources that gain units, naming their free units", async () => {
    seedSlice();

    const error = await refusal(
      choose([
        { locationId: null, quantity: 1 },
        { locationId: "loc-a", quantity: 4 },
      ])
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (3 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("writes an admitted split and makes the slice MANUAL", async () => {
    seedSlice();

    await choose([
      { locationId: null, quantity: 2 },
      { locationId: "loc-a", quantity: 3 },
    ]);

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "MANUAL" }]);
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "UNPLACED", quantity: 2 }),
        expect.objectContaining({
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 3,
        }),
      ])
    );
  });

  it("does not admit a draft's split: a draft holds nothing", async () => {
    seedSlice();

    await choose([{ locationId: "loc-a", quantity: 5 }], "DRAFT");

    expect(writtenPlan().upsertRows).toContainEqual(
      expect.objectContaining({ kind: "LOCATION", quantity: 5 })
    );
  });
});

describe("setAutoSources", () => {
  /** One MANUAL slice of 5 at Demo Warehouse. */
  function seedManual() {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "MANUAL",
          rows: [
            row("s1", { kind: "LOCATION", locationId: "loc-a", quantity: 5 }),
          ],
        }),
      ],
    });
  }

  /** Calls setAutoSources for s1. */
  function auto() {
    return setAutoSources(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      sliceId: "s1",
      window: WINDOW,
      adoptionEnabled: true,
    });
  }

  it("returns a MANUAL slice to AUTO and re-allocates its pending units by the rule", async () => {
    h.freeFor = () => free(10, 3);
    seedManual();

    await auto();

    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "AUTO" }]);
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "LOCATION", quantity: 0 }),
        expect.objectContaining({ kind: "UNPLACED", quantity: 5 }),
      ])
    );
  });

  it("refuses when the pending units fit nowhere, before any write", async () => {
    h.freeFor = () => free(2, 1);
    seedManual();

    const error = await refusal(auto());

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (1 free) and Unplaced (2 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });
});

describe("getSliceSourceSummaries", () => {
  it("returns parts, the short flag and the mode per slice", async () => {
    h.capacity = new Map([[POOL, new Map([["LOCATION:loc-a", 5]])]]);
    h.db = {
      booking: {
        findFirst: vi.fn(() => ({
          id: BOOKING,
          from: WINDOW.from,
          to: WINDOW.to,
          status: "RESERVED",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        })),
      },
      bookingAsset: {
        findMany: vi.fn(() => [
          { id: "s1", assetId: POOL, sourceAllocation: "AUTO" },
          { id: "s2", assetId: "pool-2", sourceAllocation: "LEGACY" },
        ]),
      },
      bookingAssetSource: {
        findMany: vi.fn(() => [
          {
            bookingAssetId: "s1",
            kind: "LOCATION",
            locationId: "loc-a",
            quantity: 6,
            outQuantity: 0,
            releasedQuantity: 0,
          },
        ]),
      },
      location: {
        findMany: vi.fn(() => [{ id: "loc-a", name: "Demo Warehouse" }]),
      },
    };

    const summaries = await getSliceSourceSummaries({
      organizationId: ORG,
      bookingId: BOOKING,
    });

    expect(summaries.get("s1")).toEqual({
      parts: [
        expect.objectContaining({
          label: "Demo Warehouse",
          planned: 6,
          short: true,
        }),
      ],
      short: true,
      mode: "AUTO",
    });
    expect(summaries.get("s2")).toEqual({
      parts: [],
      short: false,
      mode: "LEGACY",
    });
  });
});

describe("dispatchUnits", () => {
  const LOC_B_KEY = { kind: "LOCATION", locationId: "loc-b", createdOrder: 1 };
  /** Before the window: re-claims are admitted over the whole window. */
  const NOW = new Date("2026-11-30T09:00:00Z");

  /** Free units over the window at Unplaced, Demo Warehouse and Back Room. */
  function free3(unplaced: number, locA: number, locB: number) {
    return [
      { ...UNPLACED_KEY, free: unplaced },
      { ...LOC_A_KEY, free: locA },
      { ...LOC_B_KEY, free: locB },
    ];
  }

  /** Capacity and units on hand now per source key of the pool. */
  function stageShelf(onHand: Record<string, number>, capacity = 100) {
    h.capacity = new Map([
      [
        POOL,
        new Map([
          ["UNPLACED:", capacity],
          ["LOCATION:loc-a", capacity],
          ["LOCATION:loc-b", capacity],
        ]),
      ],
    ]);
    h.physical = new Map([[POOL, new Map(Object.entries(onHand))]]);
  }

  /** One converted AUTO slice with the given rows. */
  function seedConverted(
    rows: Array<Partial<SourceRowRecord>>,
    overrides: Partial<GroupState["slices"][number]> = {}
  ) {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          quantity: rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0),
          rows: rows.map((r) => row("s1", r)),
          ...overrides,
        }),
      ],
    });
  }

  /** Runs a dispatch of slice s1 on the fake transaction. */
  function dispatch(
    pick: { units: number; fromLocationId?: string | null },
    extra: {
      status?: string;
      clientSupportsSources?: boolean;
      now?: Date;
    } = {}
  ) {
    return dispatchUnits(
      fakeTx({ slices: [{ id: "s1" }], status: extra.status ?? "RESERVED" }),
      {
        organizationId: ORG,
        bookingId: BOOKING,
        picks: [{ sliceId: "s1", ...pick }],
        window: WINDOW,
        now: extra.now ?? NOW,
        adoptionEnabled: true,
        clientSupportsSources: extra.clientSupportsSources,
      }
    );
  }

  /** The written row of slice s1 at a source key. */
  function writtenRow(kind: string, locationId: string | null) {
    return writtenPlan().upsertRows.find(
      (r) =>
        r.bookingAssetId === "s1" &&
        r.kind === kind &&
        r.locationId === locationId
    );
  }

  /** Runs a dispatch expected to refuse and returns the error. */
  async function dispatchRefusal(call: Promise<unknown>): Promise<ShelfError> {
    return refusal(call.then(() => undefined));
  }

  it("dispatches by allocation: pending from LOCATION rows in row order, then UNPLACED", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "UNPLACED:": 20, "LOCATION:loc-a": 20 });
    // Unplaced first in row order: LOCATION rows still go first.
    seedConverted([
      { kind: "UNPLACED", quantity: 3 },
      { kind: "LOCATION", locationId: "loc-a", quantity: 5 },
    ]);

    const result = await dispatch({ units: 6 });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      outQuantity: 5,
      dispatchedTotal: 5,
    });
    expect(writtenRow("UNPLACED", null)).toMatchObject({
      outQuantity: 1,
      dispatchedTotal: 1,
    });
    expect(writtenPlan().setModes).toEqual([]);
    expect(result).toEqual({
      dispatched: [
        {
          sliceId: "s1",
          assetId: POOL,
          sources: [
            {
              kind: "LOCATION",
              locationId: "loc-a",
              name: "Demo Warehouse",
              quantity: 5,
            },
            {
              kind: "UNPLACED",
              locationId: null,
              name: "Unplaced",
              quantity: 1,
            },
          ],
        },
      ],
      legacySliceIds: [],
    });
  });

  it("sends K from the chosen source's pending when it covers K", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "UNPLACED:": 20, "LOCATION:loc-a": 20 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 5 },
      { kind: "UNPLACED", quantity: 3 },
    ]);

    await dispatch({ units: 4, fromLocationId: "loc-a" });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      quantity: 5,
      outQuantity: 4,
    });
    // The other source keeps its plan, and the slice stays AUTO.
    expect(writtenRow("UNPLACED", null)).toBeUndefined();
    expect(writtenPlan().setModes).toEqual([]);
  });

  it("moves the allocation into the chosen source when it is admitted and on hand, and the slice becomes MANUAL", async () => {
    h.freeFor = () => free3(20, 10, 20);
    stageShelf({ "UNPLACED:": 20, "LOCATION:loc-a": 10 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 2 },
      { kind: "UNPLACED", quantity: 6 },
    ]);

    await dispatch({ units: 5, fromLocationId: "loc-a" });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      quantity: 5,
      outQuantity: 5,
      dispatchedTotal: 5,
    });
    // Only the missing units moved: the rest of the split stays.
    expect(writtenRow("UNPLACED", null)).toMatchObject({ quantity: 3 });
    expect(writtenPlan().setModes).toEqual([
      { bookingAssetId: "s1", mode: "MANUAL" },
    ]);
  });

  it("refuses naming the chosen source when the move does not fit, and writes nothing", async () => {
    h.freeFor = () => free3(20, 3, 20);
    stageShelf({ "UNPLACED:": 20, "LOCATION:loc-a": 10 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 2 },
      { kind: "UNPLACED", quantity: 6 },
    ]);

    const error = await dispatchRefusal(
      dispatch({ units: 5, fromLocationId: "loc-a" })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (1 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("refuses a source that is not a placement of the pool", async () => {
    h.freeFor = () => free(20, 20);
    stageShelf({ "UNPLACED:": 20 });
    seedConverted([{ kind: "UNPLACED", quantity: 5 }]);

    const error = await dispatchRefusal(
      dispatch({ units: 5, fromLocationId: "loc-foreign" })
    );

    expect(error.message).toBe("The chosen location does not hold this asset.");
    expect(h.writes).toHaveLength(0);
  });

  it("checks physical-now only for the units leaving now", async () => {
    h.freeFor = () => free3(20, 20, 20);
    // 10 planned at Demo Warehouse, only 4 on the shelf: 4 may leave now.
    stageShelf({ "LOCATION:loc-a": 4 });
    seedConverted([{ kind: "LOCATION", locationId: "loc-a", quantity: 10 }]);

    await dispatch({ units: 4 });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({ outQuantity: 4 });
  });

  it("refuses units leaving a source that does not have them on hand", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "LOCATION:loc-a": 3 });
    seedConverted([{ kind: "LOCATION", locationId: "loc-a", quantity: 10 }]);

    const error = await dispatchRefusal(dispatch({ units: 5 }));

    expect(error.message).toBe("Only 3 units are at Demo Warehouse right now.");
    expect(h.writes).toHaveLength(0);
  });

  it("X returns 5 at A, Y reserves them, X re-dispatches: refused (re-claim fails admission)", async () => {
    // A holds 10. X took 10, returned 5 (released). Y now holds those 5 over
    // the window, so 5 are free for X, which already holds its 5 out.
    h.freeFor = () => free3(0, 5, 0);
    stageShelf({ "LOCATION:loc-a": 5 });
    seedConverted(
      [
        {
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 10,
          outQuantity: 5,
          releasedQuantity: 5,
          dispatchedTotal: 10,
          sharedQuantity: 5,
        },
      ],
      { checkedOutQuantity: 10 }
    );

    const error = await dispatchRefusal(
      dispatch({ units: 5 }, { status: "ONGOING" })
    );

    expect(error.message).toBe(
      "Not enough units at Demo Warehouse (0 free) for these dates."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("re-claims released units when the source still has room", async () => {
    h.freeFor = () => free3(0, 10, 0);
    stageShelf({ "LOCATION:loc-a": 5 });
    seedConverted(
      [
        {
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 10,
          outQuantity: 5,
          releasedQuantity: 5,
          dispatchedTotal: 10,
          sharedQuantity: 5,
        },
      ],
      { checkedOutQuantity: 10 }
    );

    await dispatch({ units: 5 }, { status: "ONGOING" });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      quantity: 10,
      outQuantity: 10,
      releasedQuantity: 0,
      dispatchedTotal: 15,
    });
  });

  it("refuses when units leaving would come from pending that needs a location", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "LOCATION:loc-a": 20 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 2 },
      { kind: "UNASSIGNED", quantity: 3 },
    ]);

    const error = await dispatchRefusal(dispatch({ units: 5 }));

    expect(error.message).toBe(
      "Cables needs a location for 3 units. Choose where they come from, then check out again."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("lets the units with a source leave while the rest still need a location", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "LOCATION:loc-a": 20 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 2 },
      { kind: "UNASSIGNED", quantity: 3 },
    ]);

    await dispatch({ units: 2 });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({ outQuantity: 2 });
  });

  it("lets a choice give pending that needs a location the chosen source, and send it out", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "LOCATION:loc-a": 20 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 2 },
      { kind: "UNASSIGNED", quantity: 3 },
    ]);

    await dispatch({ units: 5, fromLocationId: "loc-a" });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      quantity: 5,
      outQuantity: 5,
    });
    expect(writtenPlan().setModes).toEqual([
      { bookingAssetId: "s1", mode: "MANUAL" },
    ]);
  });

  it("refuses a slice short at its source, naming the source", async () => {
    h.freeFor = () => free3(20, 0, 20);
    // Demo Warehouse holds 5; an earlier booking's 5 pending come first.
    stageShelf({ "LOCATION:loc-a": 5 }, 5);
    h.holds = new Map([
      [
        POOL,
        [
          {
            sliceId: "other",
            sourceKey: "LOCATION:loc-a",
            bookingFrom: new Date("2026-11-20T09:00:00Z"),
            bookingCreatedAt: new Date("2026-10-01T09:00:00Z"),
            bookingId: "booking-earlier",
            from: new Date("2026-11-20T09:00:00Z"),
            to: new Date("2026-12-05T09:00:00Z"),
            out: 0,
            pending: 5,
          },
        ],
      ],
    ]);
    seedConverted([{ kind: "LOCATION", locationId: "loc-a", quantity: 5 }]);

    const error = await dispatchRefusal(dispatch({ units: 5 }));

    expect(error.message).toBe(
      "Cables is short at Demo Warehouse and needs a location. Change where its units come from, then check out again."
    );
  });

  /**
   * Demo Warehouse holds 5 and an earlier booking's 5 pending there come
   * first, so slice s1 is short at Demo Warehouse; Back Room has room.
   */
  function stageShortAtA() {
    h.freeFor = () => free3(20, 0, 20);
    h.capacity = new Map([
      [
        POOL,
        new Map([
          ["UNPLACED:", 100],
          ["LOCATION:loc-a", 5],
          ["LOCATION:loc-b", 100],
        ]),
      ],
    ]);
    h.physical = new Map([
      [
        POOL,
        new Map([
          ["LOCATION:loc-a", 5],
          ["LOCATION:loc-b", 20],
        ]),
      ],
    ]);
    h.holds = new Map([
      [
        POOL,
        [
          {
            sliceId: "other",
            sourceKey: "LOCATION:loc-a",
            bookingFrom: new Date("2026-11-20T09:00:00Z"),
            bookingCreatedAt: new Date("2026-10-01T09:00:00Z"),
            bookingId: "booking-earlier",
            from: new Date("2026-11-20T09:00:00Z"),
            to: new Date("2026-12-05T09:00:00Z"),
            out: 0,
            pending: 5,
          },
        ],
      ],
    ]);
    seedConverted([
      { id: "s1-b", kind: "LOCATION", locationId: "loc-b", quantity: 3 },
      { id: "s1-a", kind: "LOCATION", locationId: "loc-a", quantity: 5 },
    ]);
  }

  it("by allocation, lets units leave a source that is not short while another source is", async () => {
    stageShortAtA();

    const result = await dispatch({ units: 3 });

    expect(result.dispatched[0].sources).toEqual([
      { kind: "LOCATION", locationId: "loc-b", name: "Back Room", quantity: 3 },
    ]);
  });

  it("by allocation, refuses once the units leaving reach the short source", async () => {
    stageShortAtA();

    const error = await dispatchRefusal(dispatch({ units: 4 }));

    expect(error.message).toBe(
      "Cables is short at Demo Warehouse and needs a location. Change where its units come from, then check out again."
    );
    expect(h.writes).toHaveLength(0);
  });

  it("applies the same short rule to a choice: Back Room goes, Demo Warehouse is refused", async () => {
    stageShortAtA();

    const error = await dispatchRefusal(
      dispatch({ units: 3, fromLocationId: "loc-a" })
    );
    expect(error.message).toBe(
      "Cables is short at Demo Warehouse and needs a location. Change where its units come from, then check out again."
    );
    expect(h.writes).toHaveLength(0);

    await dispatch({ units: 3, fromLocationId: "loc-b" });
    expect(writtenRow("LOCATION", "loc-b")).toMatchObject({ outQuantity: 3 });
  });

  it("past the end of the window, skips admission and the short sweep but still checks physical-now", async () => {
    /** After the window's end: an overdue check-out. */
    const LATE = new Date("2026-12-03T09:00:00Z");
    // Over the old window this re-claim would fail admission (0 free beyond
    // what the slice holds) and the slice would be short at Demo Warehouse.
    stageShortAtA();
    h.freeFor = () => free3(0, 5, 0);
    seedConverted(
      [
        {
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 10,
          outQuantity: 5,
          releasedQuantity: 5,
          dispatchedTotal: 10,
          sharedQuantity: 5,
        },
      ],
      { checkedOutQuantity: 10 }
    );

    await dispatch({ units: 5 }, { status: "OVERDUE", now: LATE });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      outQuantity: 10,
      releasedQuantity: 0,
    });
    // The window the session measures free units over is empty.
    expect(h.windows.at(-1)).toEqual({ from: LATE, to: LATE });

    // Units not on the shelf still cannot leave.
    h.writes = [];
    h.physical = new Map([[POOL, new Map([["LOCATION:loc-a", 3]])]]);
    const error = await dispatchRefusal(
      dispatch({ units: 5 }, { status: "OVERDUE", now: LATE })
    );
    expect(error.message).toBe("Only 3 units are at Demo Warehouse right now.");
  });

  it("re-claims a fully returned slice by its plan when it departs again, staying AUTO", async () => {
    h.freeFor = () => free3(0, 5, 20);
    stageShelf({ "LOCATION:loc-a": 5, "LOCATION:loc-b": 20 });
    seedConverted(
      [
        {
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 5,
          releasedQuantity: 5,
          dispatchedTotal: 5,
        },
      ],
      { checkedOutQuantity: 5 }
    );

    await dispatch({ units: 5 }, { status: "ONGOING" });

    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({
      quantity: 5,
      outQuantity: 5,
      releasedQuantity: 0,
      dispatchedTotal: 10,
    });
    expect(writtenPlan().setModes).toEqual([]);
  });

  it("early check-out with A's units out and B free: refused at A, succeeds from B", async () => {
    h.freeFor = () => free3(0, 5, 10);
    // A's 5 are still out on a booking that returns them before this window.
    stageShelf({ "LOCATION:loc-a": 0, "LOCATION:loc-b": 10 });
    seedConverted([{ kind: "LOCATION", locationId: "loc-a", quantity: 5 }]);

    const error = await dispatchRefusal(dispatch({ units: 5 }));
    expect(error.message).toBe("Only 0 units are at Demo Warehouse right now.");
    expect(h.writes).toHaveLength(0);

    const result = await dispatch({ units: 5, fromLocationId: "loc-b" });

    expect(writtenRow("LOCATION", "loc-b")).toMatchObject({
      quantity: 5,
      outQuantity: 5,
    });
    expect(writtenRow("LOCATION", "loc-a")).toMatchObject({ quantity: 0 });
    expect(writtenPlan().setModes).toEqual([
      { bookingAssetId: "s1", mode: "MANUAL" },
    ]);
    expect(result.dispatched[0].sources).toEqual([
      { kind: "LOCATION", locationId: "loc-b", name: "Back Room", quantity: 5 },
    ]);
  });

  it("ignores an older phone's pick for a split slice and dispatches by allocation", async () => {
    h.freeFor = () => free3(20, 20, 20);
    stageShelf({ "UNPLACED:": 20, "LOCATION:loc-a": 20, "LOCATION:loc-b": 20 });
    seedConverted([
      { kind: "LOCATION", locationId: "loc-a", quantity: 5 },
      { kind: "UNPLACED", quantity: 3 },
    ]);

    const result = await dispatch(
      { units: 6, fromLocationId: "loc-b" },
      { clientSupportsSources: false }
    );

    expect(result.dispatched[0].sources.map((s) => s.name)).toEqual([
      "Demo Warehouse",
      "Unplaced",
    ]);
    expect(writtenPlan().setModes).toEqual([]);
  });

  it("converts a legacy slice that checks out against A held by a new booking, and sends it from B", async () => {
    // Demo Warehouse is fully held by a newer booking; Back Room is free.
    h.freeFor = () => free3(0, 0, 5);
    stageShelf({ "LOCATION:loc-b": 5 });
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    const result = await dispatch({ units: 5 });

    expect(writtenPlan().setModes).toEqual([
      { bookingAssetId: "s1", mode: "AUTO" },
    ]);
    expect(writtenRow("LOCATION", "loc-b")).toMatchObject({
      quantity: 5,
      outQuantity: 5,
      dispatchedTotal: 5,
    });
    expect(result.dispatched[0].sources).toEqual([
      { kind: "LOCATION", locationId: "loc-b", name: "Back Room", quantity: 5 },
    ]);
  });

  it("dispatches a kit slice from its KIT row without the physical check", async () => {
    seedConverted([{ kind: "KIT", quantity: 4 }], {
      mode: "KIT",
      assetKitId: "ak-1",
    });

    const result = await dispatch({ units: 4 });

    expect(writtenRow("KIT", null)).toMatchObject({
      outQuantity: 4,
      dispatchedTotal: 4,
    });
    expect(result.dispatched).toEqual([
      { sliceId: "s1", assetId: POOL, sources: [] },
    ]);
  });

  it("leaves a slice whose group stays LEGACY to the caller", async () => {
    seedGroup({ slices: [slice({ id: "s1", quantity: 5 })] });

    const result = await dispatchUnits(fakeTx({ slices: [{ id: "s1" }] }), {
      organizationId: ORG,
      bookingId: BOOKING,
      picks: [{ sliceId: "s1", units: 5 }],
      window: WINDOW,
      now: NOW,
      adoptionEnabled: false,
    });

    expect(result).toEqual({ dispatched: [], legacySliceIds: ["s1"] });
  });
});

describe("openSettlement and commitSettlement", () => {
  /** Before the window, so the settlement window is the booking's own. */
  const NOW = new Date("2026-11-30T09:00:00Z");

  /** A disposition log as the commit reads it back. */
  type LogRow = {
    id: string;
    assetId: string;
    bookingAssetId: string | null;
    category: string;
    quantity: number;
    createdAt: Date;
  };

  /** A new log of the booking's pool. */
  function log(overrides: Partial<LogRow> & { id: string }): LogRow {
    return {
      assetId: POOL,
      bookingAssetId: null,
      category: "RETURN",
      quantity: 1,
      createdAt: new Date("2026-12-01T12:00:00Z"),
      ...overrides,
    };
  }

  /**
   * The fake transaction plus the two reads the commit makes: the booking's
   * disposition logs (as written by the check-in) and their share sums.
   */
  function settleTx(
    sliceIds: string[],
    logs: LogRow[],
    shareSums: Array<{
      consumptionLogId: string;
      _sum: { quantity: number };
    }> = []
  ) {
    return {
      ...fakeTx({ slices: sliceIds.map((id) => ({ id })), status: "ONGOING" }),
      consumptionLog: { findMany: vi.fn(() => logs) },
      bookingDispositionShare: { groupBy: vi.fn(() => shareSums) },
    } as unknown as BookingSourcesTx;
  }

  /** Opens the settlement of BOOKING's pool. */
  function open(tx: BookingSourcesTx, adoptionEnabled = true) {
    return openSettlement(tx, {
      organizationId: ORG,
      bookingId: BOOKING,
      assetIds: [POOL],
      booking: WINDOW,
      now: NOW,
      adoptionEnabled,
    });
  }

  it("Reserve 10 at A, dispatch 5, return 1: 9 protected at A, the log shared on A", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          quantity: 10,
          checkedOutQuantity: 5,
          rows: [
            row("s1", {
              kind: "LOCATION",
              locationId: "loc-a",
              quantity: 10,
              outQuantity: 5,
              dispatchedTotal: 5,
            }),
          ],
        }),
      ],
    });
    const tx = settleTx(
      ["s1"],
      [log({ id: "log-1", bookingAssetId: "s1", quantity: 1 })]
    );

    const settlement = await open(tx);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 1 });
    await commitSettlement(tx, settlement);

    expect(h.order.slice(0, 2)).toEqual(["lock", "loadGroupStates"]);
    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual([
      expect.objectContaining({
        bookingAssetId: "s1",
        kind: "LOCATION",
        locationId: "loc-a",
        quantity: 10,
        outQuantity: 4,
        releasedQuantity: 1,
        dispatchedTotal: 5,
      }),
    ]);
    // Remaining reservation at A: quantity - released.
    expect(
      plan.upsertRows[0].quantity - plan.upsertRows[0].releasedQuantity
    ).toBe(9);
    expect(plan.insertShares).toEqual([
      {
        consumptionLogId: "log-1",
        bookingAssetId: "s1",
        sourceKey: "LOCATION:loc-a",
        quantity: 1,
        origin: "RECORDED",
      },
    ]);
  });

  it("one untagged 8-unit return over two slices: one log, two shares", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          checkedOutQuantity: 5,
          rows: [
            row("s1", { quantity: 5, outQuantity: 5, dispatchedTotal: 5 }),
          ],
        }),
        slice({
          id: "s2",
          mode: "KIT",
          assetKitId: "ak-1",
          checkedOutQuantity: 5,
          rows: [
            row("s2", {
              kind: "KIT",
              quantity: 5,
              outQuantity: 5,
              dispatchedTotal: 5,
            }),
          ],
        }),
      ],
    });
    const tx = settleTx(["s1", "s2"], [log({ id: "log-8", quantity: 8 })]);

    const settlement = await open(tx);
    const settled = settleUnits(settlement, { assetId: POOL, returned: 8 });
    await commitSettlement(tx, settlement);

    expect(settled.bookingAssetId).toBeNull();
    expect(writtenPlan().insertShares).toEqual([
      {
        consumptionLogId: "log-8",
        bookingAssetId: "s1",
        sourceKey: "UNPLACED:",
        quantity: 5,
        origin: "RECORDED",
      },
      {
        consumptionLogId: "log-8",
        bookingAssetId: "s2",
        sourceKey: "KIT:",
        quantity: 3,
        origin: "RECORDED",
      },
    ]);
    expect(
      writtenPlan().upsertRows.find((r) => r.bookingAssetId === "s2")
    ).toMatchObject({ outQuantity: 2, releasedQuantity: 3 });
  });

  it("settles units out from UNKNOWN by moving them to UNASSIGNED as released", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          quantity: 4,
          checkedOutQuantity: 4,
          rows: [
            row("s1", {
              kind: "UNKNOWN",
              quantity: 4,
              outQuantity: 4,
              dispatchedTotal: 4,
            }),
          ],
        }),
      ],
    });
    const tx = settleTx(
      ["s1"],
      [log({ id: "log-1", bookingAssetId: "s1", quantity: 4 })]
    );

    const settlement = await open(tx);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 4 });
    await commitSettlement(tx, settlement);

    const plan = writtenPlan();
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "UNKNOWN",
          quantity: 0,
          outQuantity: 0,
          releasedQuantity: 0,
          dispatchedTotal: 4,
        }),
        expect.objectContaining({
          kind: "UNASSIGNED",
          quantity: 4,
          outQuantity: 0,
          releasedQuantity: 4,
          dispatchedTotal: 0,
        }),
      ])
    );
    expect(plan.insertShares).toEqual([
      expect.objectContaining({ sourceKey: "UNKNOWN:", quantity: 4 }),
    ]);
  });

  it("Legacy ONGOING slice checked in first after activation: converted, settled, never refused", async () => {
    // Nothing is free anywhere: the seeded pending units wait on UNASSIGNED
    // instead of refusing the check-in.
    h.freeFor = () => free(0, 0);
    const earlier = log({
      id: "old-1",
      bookingAssetId: "s1",
      quantity: 2,
      createdAt: new Date("2026-12-01T10:00:00Z"),
    });
    seedGroup({
      slices: [
        slice({
          id: "s1",
          quantity: 10,
          checkedOutQuantity: 6,
          sourceLocationId: "loc-a",
        }),
      ],
      logs: [
        {
          id: earlier.id,
          bookingAssetId: "s1",
          quantity: 2,
          createdAt: earlier.createdAt,
        },
      ],
    });
    const tx = settleTx(
      ["s1"],
      [earlier, log({ id: "new-1", bookingAssetId: "s1", quantity: 4 })]
    );

    const settlement = await open(tx);
    const settled = settleUnits(settlement, {
      sliceId: "s1",
      assetId: POOL,
      returned: 4,
    });
    await commitSettlement(tx, settlement);

    expect(settled.legacy).toBe(false);
    const plan = writtenPlan();
    expect(plan.setModes).toEqual([{ bookingAssetId: "s1", mode: "AUTO" }]);
    expect(plan.upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "LOCATION",
          locationId: "loc-a",
          quantity: 6,
          outQuantity: 0,
          releasedQuantity: 6,
          dispatchedTotal: 6,
        }),
        expect.objectContaining({
          kind: "UNASSIGNED",
          quantity: 4,
          releasedQuantity: 0,
        }),
      ])
    );
    // The earlier log is seeded by the conversion; only the new one is
    // recorded by the check-in.
    expect(plan.insertShares).toEqual([
      expect.objectContaining({
        consumptionLogId: "old-1",
        origin: "SEEDED",
        quantity: 2,
      }),
      {
        consumptionLogId: "new-1",
        bookingAssetId: "s1",
        sourceKey: "LOCATION:loc-a",
        quantity: 4,
        origin: "RECORDED",
      },
    ]);
  });

  it("leaves a LEGACY group to the caller when adoption is off", async () => {
    seedGroup({
      slices: [slice({ id: "s1", quantity: 5, checkedOutQuantity: 5 })],
    });
    const tx = settleTx(["s1"], []);

    const settlement = await open(tx, false);
    const settled = settleUnits(settlement, {
      sliceId: "s1",
      assetId: POOL,
      returned: 5,
    });
    await commitSettlement(tx, settlement);

    expect(settled.legacy).toBe(true);
    expect(writtenPlan()).toEqual({
      upsertRows: [],
      deleteRowIds: [],
      insertShares: [],
      repointShares: [],
      setModes: [],
    });
  });

  it("refuses the commit when a new log was never settled, writing nothing", async () => {
    seedGroup({
      converted: true,
      slices: [
        slice({
          id: "s1",
          mode: "AUTO",
          checkedOutQuantity: 5,
          rows: [
            row("s1", { quantity: 5, outQuantity: 5, dispatchedTotal: 5 }),
          ],
        }),
      ],
    });
    const tx = settleTx(
      ["s1"],
      [
        log({ id: "log-1", bookingAssetId: "s1", quantity: 1 }),
        log({ id: "stray", category: "CONSUME", quantity: 2 }),
      ]
    );

    const settlement = await open(tx);
    settleUnits(settlement, { sliceId: "s1", assetId: POOL, returned: 1 });
    const error = await commitSettlement(tx, settlement).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(ShelfError);
    expect((error as ShelfError).status).toBe(500);
    expect(h.writes).toHaveLength(0);
  });

  it("opens nothing for a check-in without quantity-tracked assets", async () => {
    const tx = settleTx([], []);

    const settlement = await openSettlement(tx, {
      organizationId: ORG,
      bookingId: BOOKING,
      assetIds: [],
      booking: WINDOW,
    });
    await commitSettlement(tx, settlement);

    expect(h.order).toEqual([]);
    expect(h.writes).toHaveLength(0);
  });
});
