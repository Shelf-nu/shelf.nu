/**
 * `loadGroupStates` and `writeSourcePlan` against an in-memory transaction.
 *
 * The fake holds real rows per table and applies the filter shapes the
 * repository sends (equality, `{ in }`, `OR`, and `booking.organizationId`,
 * which the fake answers from an `organizationId` it stores on slices and
 * logs), so rows from another workspace are simply not there, as with the
 * real query. It also counts calls per table method, so the batching rules
 * are observable. CI has no database for unit tests, so this is where the
 * repository's reading and writing rules are proven.
 *
 * @see {@link file://./repository.server.ts}
 */

import { describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import {
  loadGroupStates,
  writeSourcePlan,
  type SourcePlanWrite,
  type SourcesTx,
} from "./repository.server";

// why: the repository only uses the transaction it is handed; the root client
// must never be reached, and importing the real one would open a connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

const ORG = "org-1";
const OTHER_ORG = "org-2";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** True when a stored row satisfies one of the filter shapes the repository sends. */
function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") {
      return (cond as Where[]).some((sub) => matches(row, sub));
    }
    if (key === "booking") {
      return row.organizationId === (cond as Where).organizationId;
    }
    if (cond !== null && typeof cond === "object" && "in" in cond) {
      return (cond as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === cond;
  });
}

/** Builds an in-memory transaction over the four tables the repository uses. */
function fakeTx(seed: {
  slices?: Row[];
  rows?: Row[];
  shares?: Row[];
  logs?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    bookingAsset: seed.slices ?? [],
    bookingAssetSource: seed.rows ?? [],
    bookingDispositionShare: seed.shares ?? [],
    consumptionLog: seed.logs ?? [],
  };
  const calls: Record<string, number> = {};
  let nextId = 1;
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  const delegate = (table: string) => ({
    findMany: (args: { where?: Where }) => {
      count(`${table}.findMany`);
      return Promise.resolve(
        tables[table]
          .filter((r) => matches(r, args.where))
          .map((r) => ({ ...r }))
      );
    },
    groupBy: (args: { by: string[]; where?: Where }) => {
      count(`${table}.groupBy`);
      const groups = new Map<string, Row & { _sum: { quantity: number } }>();
      for (const r of tables[table].filter((x) => matches(x, args.where))) {
        const key = args.by.map((b) => String(r[b])).join("|");
        const g =
          groups.get(key) ??
          Object.assign(Object.fromEntries(args.by.map((b) => [b, r[b]])), {
            _sum: { quantity: 0 },
          });
        g._sum.quantity += Number(r.quantity);
        groups.set(key, g);
      }
      return Promise.resolve([...groups.values()]);
    },
    createMany: (args: { data: Row[] }) => {
      count(`${table}.createMany`);
      for (const d of args.data) {
        tables[table].push({ id: `${table}-new-${nextId++}`, ...d });
      }
      return Promise.resolve({ count: args.data.length });
    },
    updateMany: (args: { where: Where; data: Row }) => {
      count(`${table}.updateMany`);
      const hit = tables[table].filter((r) => matches(r, args.where));
      for (const r of hit) Object.assign(r, args.data);
      return Promise.resolve({ count: hit.length });
    },
    deleteMany: (args: { where: Where }) => {
      count(`${table}.deleteMany`);
      const before = tables[table].length;
      tables[table] = tables[table].filter((r) => !matches(r, args.where));
      return Promise.resolve({ count: before - tables[table].length });
    },
  });

  const tx = {
    bookingAsset: delegate("bookingAsset"),
    bookingAssetSource: delegate("bookingAssetSource"),
    bookingDispositionShare: delegate("bookingDispositionShare"),
    consumptionLog: delegate("consumptionLog"),
  } as unknown as SourcesTx;
  return { tx, tables, calls };
}

/** A slice row; `organizationId` stands in for its booking's workspace. */
function slice(over: Row): Row {
  return {
    bookingId: "b1",
    assetId: "a1",
    quantity: 10,
    checkedOutQuantity: 0,
    assetKitId: null,
    sourceLocationId: null,
    sourceAllocation: "LEGACY",
    sourcesConvertedAt: null,
    organizationId: ORG,
    ...over,
  };
}

/** A source row with zero counters unless overridden. */
function sourceRow(over: Row): Row {
  return {
    organizationId: ORG,
    kind: "UNPLACED",
    locationId: null,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
    ...over,
  };
}

/** A share of one log. */
function share(over: Row): Row {
  return {
    organizationId: ORG,
    bookingId: "b1",
    assetId: "a1",
    bookingAssetId: null,
    bookingAssetSourceId: null,
    origin: "SEEDED",
    ...over,
  };
}

/** A plan with nothing in it, to override per test. */
function emptyPlan(over: Partial<SourcePlanWrite>): SourcePlanWrite {
  return {
    upsertRows: [],
    deleteRowIds: [],
    insertShares: [],
    repointShares: [],
    setModes: [],
    ...over,
  };
}

describe("loadGroupStates", () => {
  it("treats a group with only orphaned shares as converted", async () => {
    const { tx } = fakeTx({
      shares: [share({ id: "sh1", consumptionLogId: "l1", quantity: 3 })],
    });

    const states = await loadGroupStates(tx, {
      organizationId: ORG,
      groups: [{ bookingId: "b1", assetId: "a1" }],
    });

    expect(states.get("b1:a1")).toEqual({
      key: { bookingId: "b1", assetId: "a1" },
      converted: true,
      slices: [],
      logs: [],
    });
  });

  it("keeps an all-LEGACY group with no shares unconverted and reads only disposition logs", async () => {
    const created = new Date("2026-11-01T10:00:00Z");
    const { tx } = fakeTx({
      slices: [slice({ id: "s1", checkedOutQuantity: 4 })],
      logs: [
        {
          id: "l1",
          organizationId: ORG,
          bookingId: "b1",
          assetId: "a1",
          bookingAssetId: null,
          category: "RETURN",
          quantity: 2,
          createdAt: created,
        },
        {
          id: "l2",
          organizationId: ORG,
          bookingId: "b1",
          assetId: "a1",
          bookingAssetId: "s1",
          category: "CHECKOUT",
          quantity: 4,
          createdAt: created,
        },
      ],
    });

    const state = (
      await loadGroupStates(tx, {
        organizationId: ORG,
        groups: [{ bookingId: "b1", assetId: "a1" }],
      })
    ).get("b1:a1");

    expect(state?.converted).toBe(false);
    expect(state?.slices).toEqual([
      {
        id: "s1",
        quantity: 10,
        checkedOutQuantity: 4,
        assetKitId: null,
        sourceLocationId: null,
        recordedSourceIsUnplaced: false,
        mode: "LEGACY",
        rows: [],
      },
    ]);
    expect(state?.logs).toEqual([
      { id: "l1", bookingAssetId: null, quantity: 2, createdAt: created },
    ]);
  });

  it("returns each row with the sum of its shares and marks the group converted", async () => {
    const { tx } = fakeTx({
      slices: [slice({ id: "s1", sourceAllocation: "AUTO" })],
      rows: [
        sourceRow({
          id: "r1",
          bookingAssetId: "s1",
          quantity: 10,
          outQuantity: 2,
          releasedQuantity: 5,
          dispatchedTotal: 7,
        }),
      ],
      shares: [
        share({
          id: "sh1",
          consumptionLogId: "l1",
          bookingAssetId: "s1",
          bookingAssetSourceId: "r1",
          quantity: 3,
        }),
        share({
          id: "sh2",
          consumptionLogId: "l2",
          bookingAssetId: "s1",
          bookingAssetSourceId: "r1",
          quantity: 2,
        }),
      ],
    });

    const state = (
      await loadGroupStates(tx, {
        organizationId: ORG,
        groups: [{ bookingId: "b1", assetId: "a1" }],
      })
    ).get("b1:a1");

    expect(state?.converted).toBe(true);
    expect(state?.slices[0].mode).toBe("AUTO");
    expect(state?.slices[0].rows).toEqual([
      expect.objectContaining({ id: "r1", sharedQuantity: 5, quantity: 10 }),
    ]);
  });

  it("ignores slices, rows and shares of another workspace", async () => {
    const { tx } = fakeTx({
      slices: [
        slice({
          id: "s-foreign",
          organizationId: OTHER_ORG,
          sourceAllocation: "AUTO",
        }),
      ],
      shares: [
        share({
          id: "sh1",
          organizationId: OTHER_ORG,
          consumptionLogId: "l1",
          quantity: 1,
        }),
      ],
    });

    const state = (
      await loadGroupStates(tx, {
        organizationId: ORG,
        groups: [{ bookingId: "b1", assetId: "a1" }],
      })
    ).get("b1:a1");

    expect(state).toEqual({
      key: { bookingId: "b1", assetId: "a1" },
      converted: false,
      slices: [],
      logs: [],
    });
  });
});

describe("writeSourcePlan", () => {
  /** A LEGACY slice with a 4-unit return, converting to AUTO. */
  function conversionFixture() {
    return fakeTx({
      slices: [slice({ id: "s1", checkedOutQuantity: 6 })],
      logs: [
        {
          id: "l1",
          organizationId: ORG,
          bookingId: "b1",
          assetId: "a1",
          bookingAssetId: "s1",
          category: "RETURN",
          quantity: 4,
          createdAt: new Date(),
        },
      ],
    });
  }

  it("writes rows and shares in one batch per table and resolves share keys to the new ids", async () => {
    const { tx, tables, calls } = conversionFixture();

    await writeSourcePlan(tx, {
      organizationId: ORG,
      plan: emptyPlan({
        upsertRows: [
          {
            bookingAssetId: "s1",
            kind: "LOCATION",
            locationId: "loc-a",
            quantity: 6,
            outQuantity: 2,
            releasedQuantity: 4,
            dispatchedTotal: 6,
          },
          {
            bookingAssetId: "s1",
            kind: "UNPLACED",
            locationId: null,
            quantity: 4,
            outQuantity: 0,
            releasedQuantity: 0,
            dispatchedTotal: 0,
          },
        ],
        insertShares: [
          {
            consumptionLogId: "l1",
            bookingAssetId: "s1",
            sourceKey: "LOCATION:loc-a",
            quantity: 4,
            origin: "SEEDED",
          },
        ],
        setModes: [{ bookingAssetId: "s1", mode: "AUTO" }],
      }),
    });

    expect(calls["bookingAssetSource.createMany"]).toBe(1);
    expect(calls["bookingDispositionShare.createMany"]).toBe(1);
    const locationRow = tables.bookingAssetSource.find(
      (r) => r.kind === "LOCATION"
    );
    expect(tables.bookingAssetSource).toHaveLength(2);
    expect(tables.bookingDispositionShare).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        consumptionLogId: "l1",
        bookingId: "b1",
        assetId: "a1",
        bookingAssetId: "s1",
        bookingAssetSourceId: locationRow?.id,
        quantity: 4,
        origin: "SEEDED",
      }),
    ]);
    expect(tables.bookingAsset[0]).toMatchObject({
      sourceAllocation: "AUTO",
      sourcesConvertedAt: expect.any(Date),
    });
  });

  it("refuses a plan whose rows break the row rules and writes nothing", async () => {
    const { tx, tables, calls } = conversionFixture();

    const write = writeSourcePlan(tx, {
      organizationId: ORG,
      plan: emptyPlan({
        upsertRows: [
          // out + released exceeds quantity
          {
            bookingAssetId: "s1",
            kind: "UNPLACED",
            locationId: null,
            quantity: 3,
            outQuantity: 2,
            releasedQuantity: 2,
            dispatchedTotal: 2,
          },
        ],
        setModes: [{ bookingAssetId: "s1", mode: "AUTO" }],
      }),
    });

    await expect(write).rejects.toBeInstanceOf(ShelfError);
    await expect(write).rejects.toMatchObject({
      status: 500,
      shouldBeCaptured: true,
      label: "Booking",
    });
    expect(tables.bookingAssetSource).toHaveLength(0);
    expect(calls["bookingAssetSource.createMany"]).toBeUndefined();
    expect(tables.bookingAsset[0].sourceAllocation).toBe("LEGACY");
  });

  it("refuses a row whose shares do not reconcile with its departures", async () => {
    const { tx } = conversionFixture();

    await expect(
      writeSourcePlan(tx, {
        organizationId: ORG,
        plan: emptyPlan({
          upsertRows: [
            // dispatched 6, out 2, but no shares: 6 - 0 != 2
            {
              bookingAssetId: "s1",
              kind: "UNPLACED",
              locationId: null,
              quantity: 10,
              outQuantity: 2,
              releasedQuantity: 4,
              dispatchedTotal: 6,
            },
          ],
          setModes: [{ bookingAssetId: "s1", mode: "AUTO" }],
        }),
      })
    ).rejects.toMatchObject({ status: 500 });
  });

  it("refuses a share that names a row the plan does not write", async () => {
    const { tx } = conversionFixture();

    await expect(
      writeSourcePlan(tx, {
        organizationId: ORG,
        plan: emptyPlan({
          upsertRows: [
            {
              bookingAssetId: "s1",
              kind: "UNPLACED",
              locationId: null,
              quantity: 10,
              outQuantity: 2,
              releasedQuantity: 4,
              dispatchedTotal: 6,
            },
          ],
          insertShares: [
            {
              consumptionLogId: "l1",
              bookingAssetId: "s1",
              sourceKey: "LOCATION:loc-z",
              quantity: 4,
              origin: "SEEDED",
            },
          ],
        }),
      })
    ).rejects.toMatchObject({ status: 500 });
  });

  it("refuses a slice from another workspace", async () => {
    const { tx, tables } = fakeTx({
      slices: [slice({ id: "s-foreign", organizationId: OTHER_ORG })],
    });

    await expect(
      writeSourcePlan(tx, {
        organizationId: ORG,
        plan: emptyPlan({
          upsertRows: [
            {
              bookingAssetId: "s-foreign",
              kind: "UNASSIGNED",
              locationId: null,
              quantity: 10,
              outQuantity: 0,
              releasedQuantity: 0,
              dispatchedTotal: 0,
            },
          ],
        }),
      })
    ).rejects.toMatchObject({ status: 500 });
    expect(tables.bookingAssetSource).toHaveLength(0);
  });

  it("drops all-zero rows but keeps one row per converted slice, a known kind first", async () => {
    const { tx, tables } = fakeTx({
      slices: [
        slice({
          id: "s1",
          quantity: 0,
          sourceAllocation: "AUTO",
          sourcesConvertedAt: new Date(),
        }),
        slice({
          id: "s2",
          assetId: "a2",
          quantity: 5,
          sourceAllocation: "AUTO",
          sourcesConvertedAt: new Date(),
        }),
      ],
      rows: [
        sourceRow({ id: "r-unknown-2", bookingAssetId: "s2", kind: "UNKNOWN" }),
      ],
    });

    await writeSourcePlan(tx, {
      organizationId: ORG,
      plan: emptyPlan({
        upsertRows: [
          // s1 (Q = 0): two all-zero rows; the UNPLACED one stays.
          {
            bookingAssetId: "s1",
            kind: "UNKNOWN",
            locationId: null,
            quantity: 0,
            outQuantity: 0,
            releasedQuantity: 0,
            dispatchedTotal: 0,
          },
          {
            bookingAssetId: "s1",
            kind: "UNPLACED",
            locationId: null,
            quantity: 0,
            outQuantity: 0,
            releasedQuantity: 0,
            dispatchedTotal: 0,
          },
          // s2: the existing all-zero UNKNOWN goes next to a real row.
          {
            bookingAssetId: "s2",
            kind: "LOCATION",
            locationId: "loc-a",
            quantity: 5,
            outQuantity: 0,
            releasedQuantity: 0,
            dispatchedTotal: 0,
          },
        ],
      }),
    });

    const rowsOf = (id: string) =>
      tables.bookingAssetSource
        .filter((r) => r.bookingAssetId === id)
        .map((r) => `${r.kind}:${r.locationId ?? ""}`);
    expect(rowsOf("s1")).toEqual(["UNPLACED:"]);
    expect(rowsOf("s2")).toEqual(["LOCATION:loc-a"]);
  });

  it("moves shares to another slice's row before deleting the emptied origin", async () => {
    const { tx, tables } = fakeTx({
      slices: [
        slice({
          id: "s-kit",
          assetKitId: "ak1",
          sourceAllocation: "KIT",
          sourcesConvertedAt: new Date(),
          quantity: 0,
          checkedOutQuantity: 0,
        }),
        slice({
          id: "s1",
          sourceAllocation: "AUTO",
          sourcesConvertedAt: new Date(),
          quantity: 3,
          checkedOutQuantity: 3,
        }),
      ],
      rows: [
        sourceRow({
          id: "r-kit",
          bookingAssetId: "s-kit",
          kind: "KIT",
          quantity: 0,
          dispatchedTotal: 0,
        }),
        sourceRow({
          id: "r-hist",
          bookingAssetId: "s-kit",
          kind: "UNKNOWN",
          quantity: 0,
          dispatchedTotal: 3,
        }),
        sourceRow({
          id: "r1",
          bookingAssetId: "s1",
          kind: "UNPLACED",
          quantity: 3,
          releasedQuantity: 0,
          outQuantity: 3,
          dispatchedTotal: 3,
        }),
      ],
      shares: [
        share({
          id: "sh1",
          consumptionLogId: "l1",
          bookingAssetId: "s-kit",
          bookingAssetSourceId: "r-hist",
          quantity: 3,
        }),
      ],
    });

    await writeSourcePlan(tx, {
      organizationId: ORG,
      plan: emptyPlan({
        upsertRows: [
          {
            bookingAssetId: "s-kit",
            kind: "UNKNOWN",
            locationId: null,
            quantity: 0,
            outQuantity: 0,
            releasedQuantity: 0,
            dispatchedTotal: 0,
          },
          {
            bookingAssetId: "s1",
            kind: "UNPLACED",
            locationId: null,
            quantity: 3,
            outQuantity: 3,
            releasedQuantity: 0,
            dispatchedTotal: 6,
          },
        ],
        repointShares: [
          { fromRowId: "r-hist", toBookingAssetId: "s1", toKey: "UNPLACED:" },
        ],
        deleteRowIds: ["r-hist"],
      }),
    });

    expect(tables.bookingDispositionShare[0]).toMatchObject({
      bookingAssetId: "s1",
      bookingAssetSourceId: "r1",
    });
    expect(tables.bookingAssetSource.map((r) => r.id).sort()).toEqual([
      "r-kit",
      "r1",
    ]);
  });

  it("refuses to delete a row that still has history", async () => {
    const { tx } = fakeTx({
      slices: [
        slice({
          id: "s1",
          sourceAllocation: "AUTO",
          sourcesConvertedAt: new Date(),
          quantity: 0,
        }),
      ],
      rows: [
        sourceRow({
          id: "r1",
          bookingAssetId: "s1",
          kind: "UNKNOWN",
          dispatchedTotal: 2,
        }),
      ],
      shares: [
        share({
          id: "sh1",
          consumptionLogId: "l1",
          bookingAssetId: "s1",
          bookingAssetSourceId: "r1",
          quantity: 2,
        }),
      ],
    });

    await expect(
      writeSourcePlan(tx, {
        organizationId: ORG,
        plan: emptyPlan({ deleteRowIds: ["r1"] }),
      })
    ).rejects.toMatchObject({ status: 500 });
  });

  it("keeps an existing conversion time and refuses a return to LEGACY", async () => {
    const convertedAt = new Date("2026-11-01T00:00:00Z");
    const { tx, tables } = fakeTx({
      slices: [
        slice({
          id: "s1",
          sourceAllocation: "AUTO",
          sourcesConvertedAt: convertedAt,
        }),
      ],
      rows: [sourceRow({ id: "r1", bookingAssetId: "s1", quantity: 10 })],
    });

    await writeSourcePlan(tx, {
      organizationId: ORG,
      plan: emptyPlan({ setModes: [{ bookingAssetId: "s1", mode: "MANUAL" }] }),
    });
    expect(tables.bookingAsset[0]).toMatchObject({
      sourceAllocation: "MANUAL",
      sourcesConvertedAt: convertedAt,
    });

    await expect(
      writeSourcePlan(tx, {
        organizationId: ORG,
        plan: emptyPlan({
          setModes: [{ bookingAssetId: "s1", mode: "LEGACY" }],
        }),
      })
    ).rejects.toMatchObject({ status: 500 });
  });
});
