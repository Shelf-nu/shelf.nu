/**
 * Per-source capacity, competing holds, free units over a window and
 * physical units on hand now, against an in-memory transaction.
 *
 * The fake stores real rows per table and applies the filter shapes the
 * readers send (equality, `null`, `{ in }`, `{ not }`, `{ gt }`, `{ lt }`,
 * `OR` / `AND`, and the `booking` / `asset` relations), so a draft, a
 * terminal booking or another workspace's row is filtered the way the real
 * query filters it. CI has no database for unit tests.
 *
 * @see {@link file://./capacity.server.ts}
 */

import { describe, expect, it, vi } from "vitest";

import {
  computeFreeBySource,
  loadCompetingHolds,
  loadPhysicalNow,
  loadSourceCapacity,
  type CapacityTx,
} from "./capacity.server";

// why: the readers only use the transaction they are handed; importing the
// real root client (pulled in by the units-out reader) would open a connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

const ORG = "org-1";
const OTHER_ORG = "org-2";
const POOL = "pool-1";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

type Tables = {
  assets: Row[];
  placements: Row[];
  custody: Row[];
  bookings: Row[];
  slices: Row[];
  sources: Row[];
  logs: Row[];
};

/** True when a stored value satisfies one filter condition. */
function matchesValue(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (typeof cond !== "object" || cond instanceof Date) return value === cond;
  const c = cond as Record<string, unknown>;
  if ("in" in c) return (c.in as unknown[]).includes(value);
  if ("not" in c) {
    return c.not === null ? value != null : value !== c.not;
  }
  if ("gt" in c) return (value as number | Date) > (c.gt as number | Date);
  if ("lt" in c) return (value as number | Date) < (c.lt as number | Date);
  return false;
}

/** Builds an in-memory transaction over the tables the readers use. */
function fakeTx(seed: Partial<Tables>) {
  const t: Tables = {
    assets: [],
    placements: [],
    custody: [],
    bookings: [],
    slices: [],
    sources: [],
    logs: [],
    ...seed,
  };
  const relation = (row: Row, key: string): Row | undefined => {
    if (key === "booking")
      return t.bookings.find((b) => b.id === row.bookingId);
    if (key === "asset") return t.assets.find((a) => a.id === row.assetId);
    return undefined;
  };
  const matches = (row: Row, where: Where | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
      if (key === "AND") return (cond as Where[]).every((w) => matches(row, w));
      if (key === "booking" || key === "asset") {
        const related = relation(row, key);
        return related !== undefined && matches(related, cond as Where);
      }
      return matchesValue(row[key], cond);
    });
  };
  const withBooking = (row: Row) => ({
    ...row,
    booking: relation(row, "booking"),
  });
  const find = (rows: Row[], map: (r: Row) => Row = (r) => r) =>
    vi.fn((args: { where?: Where }) =>
      Promise.resolve(rows.filter((r) => matches(r, args.where)).map(map))
    );

  return {
    asset: { findMany: find(t.assets) },
    assetLocation: { findMany: find(t.placements) },
    custody: {
      groupBy: vi.fn((args: { by: string[]; where?: Where }) => {
        const groups = new Map<string, Row & { _sum: { quantity: number } }>();
        for (const row of t.custody.filter((r) => matches(r, args.where))) {
          const id = args.by.map((k) => String(row[k] ?? null)).join("|");
          const group = groups.get(id) ?? {
            ...Object.fromEntries(args.by.map((k) => [k, row[k] ?? null])),
            _sum: { quantity: 0 },
          };
          group._sum.quantity += row.quantity as number;
          groups.set(id, group);
        }
        return Promise.resolve([...groups.values()]);
      }),
    },
    bookingAsset: { findMany: find(t.slices, withBooking) },
    bookingAssetSource: { findMany: find(t.sources) },
    consumptionLog: { findMany: find(t.logs) },
  };
}

/** Casts the fake to the reader's client type. */
function asTx(tx: ReturnType<typeof fakeTx>): CapacityTx {
  return tx as unknown as CapacityTx;
}

/** A booking row. */
function booking(
  id: string,
  status: string,
  from: string,
  to: string,
  organizationId = ORG
): Row {
  return {
    id,
    status,
    organizationId,
    from: new Date(from),
    to: new Date(to),
    createdAt: new Date("2025-12-01"),
  };
}

/** A slice row; converted AUTO standalone unless overridden. */
function slice(id: string, bookingId: string, over: Row = {}): Row {
  return {
    id,
    bookingId,
    assetId: POOL,
    quantity: 0,
    assetKitId: null,
    sourceKitId: null,
    sourceLocationId: null,
    sourceAllocation: "AUTO",
    checkedOutQuantity: 0,
    ...over,
  };
}

/** A source row. */
function row(
  bookingAssetId: string,
  kind: string,
  locationId: string | null,
  counters: { quantity: number; out?: number; released?: number },
  organizationId = ORG
): Row {
  return {
    id: `${bookingAssetId}-${kind}-${locationId ?? ""}`,
    organizationId,
    bookingAssetId,
    kind,
    locationId,
    quantity: counters.quantity,
    outQuantity: counters.out ?? 0,
    releasedQuantity: counters.released ?? 0,
    dispatchedTotal: counters.out ?? 0,
  };
}

/** A pool of `quantity` units with manual placements, oldest first. */
function pool(quantity: number, placements: Array<[string, number]>) {
  return {
    assets: [{ id: POOL, organizationId: ORG, quantity }],
    placements: placements.map(([locationId, q], i) => ({
      id: `pl-${i}`,
      assetId: POOL,
      organizationId: ORG,
      locationId,
      quantity: q,
      assetKitId: null,
    })),
  };
}

const WINDOW = {
  from: new Date("2026-01-10T00:00:00Z"),
  to: new Date("2026-01-20T00:00:00Z"),
};

describe("loadSourceCapacity", () => {
  it("is placed minus custody taken from each source, kit units left out", async () => {
    const base = pool(20, [
      ["loc-a", 8],
      ["loc-b", 5],
    ]);
    const tx = fakeTx({
      ...base,
      placements: [
        ...base.placements,
        // A kit-driven placement is the kit's, not a manual source.
        {
          id: "pl-kit",
          assetId: POOL,
          organizationId: ORG,
          locationId: "loc-a",
          quantity: 4,
          assetKitId: "ak-1",
        },
      ],
      custody: [
        {
          assetId: POOL,
          locationId: "loc-a",
          sourceUnknown: false,
          kitCustodyId: null,
          quantity: 2,
        },
        {
          assetId: POOL,
          locationId: null,
          sourceUnknown: false,
          kitCustodyId: null,
          quantity: 1,
        },
        // Unrecorded source and kit-inherited custody count against no source.
        {
          assetId: POOL,
          locationId: null,
          sourceUnknown: true,
          kitCustodyId: null,
          quantity: 3,
        },
        {
          assetId: POOL,
          locationId: null,
          sourceUnknown: false,
          kitCustodyId: "kc-1",
          quantity: 4,
        },
      ],
    });

    const capacity = await loadSourceCapacity(asTx(tx), {
      organizationId: ORG,
      assetIds: [POOL],
    });

    expect(capacity.get(POOL)).toEqual(
      new Map([
        ["UNPLACED:", 20 - 13 - 1],
        ["LOCATION:loc-a", 6],
        ["LOCATION:loc-b", 5],
      ])
    );
  });

  it("leaves out a pool from another workspace", async () => {
    const tx = fakeTx({
      assets: [{ id: POOL, organizationId: OTHER_ORG, quantity: 5 }],
    });

    const capacity = await loadSourceCapacity(asTx(tx), {
      organizationId: ORG,
      assetIds: [POOL],
    });

    expect(capacity.size).toBe(0);
  });
});

describe("computeFreeBySource", () => {
  it("drafts never compete", async () => {
    const tx = fakeTx({
      ...pool(10, [["loc-a", 10]]),
      bookings: [booking("draft", "DRAFT", "2026-01-12", "2026-01-15")],
      slices: [slice("s-draft", "draft")],
      sources: [row("s-draft", "LOCATION", "loc-a", { quantity: 10 })],
    });

    const free = await computeFreeBySource(asTx(tx), {
      organizationId: ORG,
      assetId: POOL,
      window: WINDOW,
    });

    expect(free).toEqual([
      { kind: "UNPLACED", locationId: null, free: 0, createdOrder: -1 },
      { kind: "LOCATION", locationId: "loc-a", free: 10, createdOrder: 0 },
    ]);
  });

  it("back-to-back windows both fit", async () => {
    // [Jan 1, Jan 10) ends exactly when the window [Jan 10, Jan 20) starts.
    const tx = fakeTx({
      ...pool(10, [["loc-a", 10]]),
      bookings: [
        booking(
          "before",
          "RESERVED",
          "2026-01-01T00:00:00Z",
          "2026-01-10T00:00:00Z"
        ),
      ],
      slices: [slice("s-before", "before")],
      sources: [row("s-before", "LOCATION", "loc-a", { quantity: 10 })],
    });

    const free = await computeFreeBySource(asTx(tx), {
      organizationId: ORG,
      assetId: POOL,
      window: WINDOW,
    });

    expect(free.find((s) => s.locationId === "loc-a")?.free).toBe(10);
  });

  it("subtracts the peak of other active holds at the source, never their sum", async () => {
    const tx = fakeTx({
      ...pool(12, [
        ["loc-a", 10],
        ["loc-b", 1],
      ]),
      bookings: [
        booking(
          "r1",
          "RESERVED",
          "2026-01-10T00:00:00Z",
          "2026-01-12T00:00:00Z"
        ),
        booking(
          "r2",
          "RESERVED",
          "2026-01-14T00:00:00Z",
          "2026-01-25T00:00:00Z"
        ),
        // Overdue since Jan 5: its out units have no known return.
        booking(
          "od",
          "OVERDUE",
          "2026-01-01T00:00:00Z",
          "2026-01-05T00:00:00Z"
        ),
        booking(
          "self",
          "RESERVED",
          "2026-01-10T00:00:00Z",
          "2026-01-20T00:00:00Z"
        ),
        booking(
          "done",
          "COMPLETE",
          "2026-01-10T00:00:00Z",
          "2026-01-20T00:00:00Z"
        ),
        booking(
          "legacy",
          "RESERVED",
          "2026-01-10T00:00:00Z",
          "2026-01-20T00:00:00Z"
        ),
        booking(
          "kit",
          "ONGOING",
          "2026-01-10T00:00:00Z",
          "2026-01-20T00:00:00Z"
        ),
      ],
      slices: [
        slice("s-r1", "r1"),
        slice("s-r2", "r2"),
        slice("s-od", "od"),
        slice("s-self", "self"),
        slice("s-done", "done"),
        slice("s-legacy", "legacy", {
          sourceAllocation: "LEGACY",
          quantity: 9,
          sourceLocationId: "loc-a",
        }),
        slice("s-kit", "kit", { sourceAllocation: "KIT", assetKitId: "ak-1" }),
      ],
      sources: [
        row("s-r1", "LOCATION", "loc-a", { quantity: 3 }),
        // 4 planned, 1 came back: 3 still held.
        row("s-r2", "LOCATION", "loc-a", { quantity: 4, released: 1 }),
        row("s-od", "LOCATION", "loc-a", { quantity: 2, out: 2 }),
        row("s-self", "LOCATION", "loc-a", { quantity: 9 }),
        row("s-done", "LOCATION", "loc-a", { quantity: 9, out: 9 }),
        row("s-kit", "KIT", null, { quantity: 5, out: 5 }),
        // UNASSIGNED holds no location capacity.
        row("s-r1", "UNASSIGNED", null, { quantity: 6 }),
        row("s-r2", "UNPLACED", null, { quantity: 1 }),
      ],
    });

    const free = await computeFreeBySource(asTx(tx), {
      organizationId: ORG,
      assetId: POOL,
      window: WINDOW,
      excludeBookingId: "self",
    });

    // loc-a: 10 - (overdue 2 + max(r1 3, r2 3)) = 5. Unplaced: 1 - 1 = 0.
    expect(free).toEqual([
      { kind: "UNPLACED", locationId: null, free: 0, createdOrder: -1 },
      { kind: "LOCATION", locationId: "loc-a", free: 5, createdOrder: 0 },
      { kind: "LOCATION", locationId: "loc-b", free: 1, createdOrder: 1 },
    ]);
  });

  it("floors free at 0 when custody and holds exceed what is placed", async () => {
    const tx = fakeTx({
      ...pool(3, [["loc-a", 3]]),
      custody: [
        {
          assetId: POOL,
          locationId: "loc-a",
          sourceUnknown: false,
          kitCustodyId: null,
          quantity: 2,
        },
      ],
      bookings: [booking("r1", "RESERVED", "2026-01-11", "2026-01-12")],
      slices: [slice("s-r1", "r1")],
      sources: [row("s-r1", "LOCATION", "loc-a", { quantity: 3 })],
    });

    const free = await computeFreeBySource(asTx(tx), {
      organizationId: ORG,
      assetId: POOL,
      window: WINDOW,
    });

    expect(free.find((s) => s.locationId === "loc-a")?.free).toBe(0);
  });
});

describe("loadCompetingHolds", () => {
  it("splits each hold into out and pending over its booking interval", async () => {
    const tx = fakeTx({
      ...pool(10, [["loc-a", 10]]),
      bookings: [
        booking(
          "on",
          "ONGOING",
          "2026-01-11T00:00:00Z",
          "2026-01-13T00:00:00Z"
        ),
        booking(
          "draft",
          "DRAFT",
          "2026-01-11T00:00:00Z",
          "2026-01-13T00:00:00Z"
        ),
      ],
      slices: [slice("s-on", "on"), slice("s-draft", "draft")],
      sources: [
        row("s-on", "LOCATION", "loc-a", { quantity: 6, out: 2, released: 1 }),
        // Fully released: nothing left to hold.
        row("s-on", "UNPLACED", null, { quantity: 2, released: 2 }),
        row("s-draft", "LOCATION", "loc-a", { quantity: 4 }),
      ],
    });

    const holds = await loadCompetingHolds(asTx(tx), {
      organizationId: ORG,
      assetIds: [POOL],
      window: WINDOW,
    });

    expect(holds).toEqual([
      {
        sliceId: "s-on",
        sourceKey: "LOCATION:loc-a",
        bookingFrom: new Date("2026-01-11T00:00:00Z"),
        bookingCreatedAt: new Date("2025-12-01"),
        bookingId: "on",
        from: new Date("2026-01-11T00:00:00Z"),
        to: new Date("2026-01-13T00:00:00Z"),
        out: 2,
        pending: 3,
      },
    ]);
  });
});

describe("loadPhysicalNow", () => {
  it("physical-now ignores kit departures", async () => {
    // 5 manual units at A; a kit at A took its own 5 out, both as a
    // converted KIT row and as a LEGACY kit slice recording A.
    const base = pool(10, [["loc-a", 5]]);
    const tx = fakeTx({
      ...base,
      bookings: [
        booking("kit-new", "ONGOING", "2026-01-01", "2026-01-20"),
        booking("kit-old", "OVERDUE", "2026-01-01", "2026-01-05"),
      ],
      slices: [
        slice("s-kit-new", "kit-new", {
          sourceAllocation: "KIT",
          assetKitId: "ak-1",
        }),
        slice("s-kit-old", "kit-old", {
          sourceAllocation: "LEGACY",
          assetKitId: "ak-1",
          sourceLocationId: "loc-a",
          quantity: 5,
          checkedOutQuantity: 5,
        }),
      ],
      sources: [row("s-kit-new", "KIT", null, { quantity: 5, out: 5 })],
    });

    const now = await loadPhysicalNow(asTx(tx), {
      organizationId: ORG,
      assetIds: [POOL],
    });

    expect(now.get(POOL)?.get("LOCATION:loc-a")).toBe(5);
  });

  it("subtracts converted rows out now and LEGACY units out, never terminal bookings", async () => {
    const tx = fakeTx({
      ...pool(10, [["loc-a", 6]]),
      bookings: [
        booking("on", "ONGOING", "2026-01-01", "2026-01-20"),
        booking("legacy", "ONGOING", "2026-01-01", "2026-01-20"),
        booking("done", "COMPLETE", "2026-01-01", "2026-01-05"),
        booking("cancelled", "CANCELLED", "2026-01-01", "2026-01-05"),
        booking("reserved", "RESERVED", "2026-01-01", "2026-01-20"),
      ],
      slices: [
        slice("s-on", "on"),
        slice("s-legacy", "legacy", {
          sourceAllocation: "LEGACY",
          sourceLocationId: "loc-a",
          quantity: 1,
          checkedOutQuantity: 1,
        }),
        slice("s-done", "done"),
        slice("s-cancelled", "cancelled"),
        slice("s-reserved", "reserved"),
      ],
      sources: [
        row("s-on", "LOCATION", "loc-a", { quantity: 2, out: 2 }),
        row("s-on", "UNPLACED", null, { quantity: 1, out: 1 }),
        // UNKNOWN units out charge no loose source.
        row("s-on", "UNKNOWN", null, { quantity: 3, out: 3 }),
        // Terminal bookings keep their counters but never count.
        row("s-done", "LOCATION", "loc-a", { quantity: 3, out: 3 }),
        row("s-cancelled", "UNPLACED", null, { quantity: 2, out: 2 }),
        row("s-reserved", "LOCATION", "loc-a", { quantity: 4 }),
      ],
    });

    const now = await loadPhysicalNow(asTx(tx), {
      organizationId: ORG,
      assetIds: [POOL],
    });

    // loc-a: 6 - 2 converted - 1 legacy = 3. Unplaced: 4 - 1 = 3.
    expect(now.get(POOL)).toEqual(
      new Map([
        ["UNPLACED:", 3],
        ["LOCATION:loc-a", 3],
      ])
    );
  });
});
