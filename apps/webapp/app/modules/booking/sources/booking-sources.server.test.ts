/**
 * The booking-sources facade: new slices, resizes, window changes, silent
 * re-allocation of AUTO slices that no longer fit, and the display summary.
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
  getSliceSourceSummaries,
  resizeSlices,
} from "./booking-sources.server";
import type { BookingSourcesTx } from "./conversion.server";
import type * as RepositoryModule from "./repository.server";
import type {
  GroupState,
  SourcePlanWrite,
  SourceRowRecord,
} from "./repository.server";

type FreeArgs = { window: { from: Date; to: Date } };

const h = vi.hoisted(() => ({
  order: [] as string[],
  states: new Map<string, unknown>(),
  freeFor: (_args: FreeArgs): unknown[] => [],
  writes: [] as unknown[],
  db: {} as Record<string, unknown>,
  capacity: new Map<string, Map<string, number>>(),
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
  computeFreeBySource: vi.fn((_tx: unknown, args: FreeArgs) => {
    h.order.push("computeFreeBySource");
    return h.freeFor(args);
  }),
  loadSourceCapacity: vi.fn(() => h.capacity),
  loadCompetingHolds: vi.fn(() => []),
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
      findFirst: vi.fn(() => ({ status: args.status ?? "RESERVED" })),
    },
    location: {
      findMany: vi.fn(() => [{ id: "loc-a", name: "Demo Warehouse" }]),
    },
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
  h.freeFor = () => free(20, 0);
  h.capacity = new Map();
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
      "computeFreeBySource",
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
