/**
 * Behaviour tests for custody source locations, run through the real
 * services against an in-memory stand-in for the tables they touch.
 *
 * The rules are "where did the units come from" rules, so the assertions are
 * about resulting rows (placements, custody rows, ledger rows), not about
 * which Prisma calls were made. The stand-in implements just enough of the
 * Prisma surface for `checkOutQuantity`, `releaseQuantity`,
 * `adjustQuantity` and `moveAssetLocationUnits` to run unmodified.
 *
 * @see {@link file://./custody-source.ts} - the pure rules (own unit tests)
 * @see {@link file://./service.server.ts} - checkOutQuantity / releaseQuantity / moveAssetLocationUnits
 * @see {@link file://../consumption-log/service.server.ts} - adjustQuantity
 */

/* eslint-disable @typescript-eslint/require-await -- the in-memory stand-in mirrors Prisma's promise-returning delegates without awaiting anything itself */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adjustQuantity } from "~/modules/consumption-log/service.server";
import type { ShelfError } from "~/utils/error";
import {
  loadCustodySourcesForAssets,
  rehomeCustodyForPlacementChanges,
} from "./custody-source.server";
import {
  checkOutQuantity,
  moveAssetLocationUnits,
  releaseQuantity,
} from "./service.server";

/* -------------------------------------------------------------------------- */
/*                         In-memory table stand-in                           */
/* -------------------------------------------------------------------------- */

/**
 * Built inside `vi.hoisted` because `vi.mock` factories run before the rest
 * of the module, and the db mock below hands out this stand-in.
 */
const { tables, fakeDb, counter } = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };

  type Tables = {
    asset: Row[];
    assetLocation: Row[];
    custody: Row[];
    location: Row[];
    teamMember: Row[];
    consumptionLog: Row[];
  };

  const tables: Tables = {
    asset: [],
    assetLocation: [],
    custody: [],
    location: [],
    teamMember: [],
    consumptionLog: [],
  };

  const counter = { next: 1 };
  const newId = (prefix: string) => `${prefix}-${counter.next++}`;

  /**
   * Prisma-style `where` matching for the shapes these services use: equality
   * (NULL included), `{ in }`, `{ not }`, `OR`. Relation filters such as
   * `asset: { organizationId }` are treated as satisfied: every row here
   * belongs to the one test workspace.
   */
  function matches(row: Row, where?: Record<string, unknown>): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Record<string, unknown>[]).some((w) =>
          matches(row, w)
        );
      }
      if (condition === undefined) return true;
      if (
        condition !== null &&
        typeof condition === "object" &&
        !(condition instanceof Date)
      ) {
        const c = condition as Record<string, unknown>;
        if ("in" in c) return (c.in as unknown[]).includes(row[key]);
        if ("not" in c) return row[key] !== c.not;
        return true;
      }
      return (row[key] ?? null) === condition;
    });
  }

  /** Applies `{ increment }` / `{ decrement }` / plain values to a row. */
  function applyData(row: Row, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !(value instanceof Date)
      ) {
        const v = value as { increment?: number; decrement?: number };
        if (typeof v.increment === "number") {
          row[key] = (row[key] as number) + v.increment;
          continue;
        }
        if (typeof v.decrement === "number") {
          row[key] = (row[key] as number) - v.decrement;
          continue;
        }
      }
      row[key] = value;
    }
  }

  /** A placement row with its `location` relation attached, as selects expect. */
  function withLocation(row: Row) {
    return {
      ...row,
      location: tables.location.find((l) => l.id === row.locationId) ?? null,
    };
  }

  const sum = (rows: Row[], field = "quantity") =>
    rows.reduce((total, row) => total + (row[field] as number), 0);

  const fakeDb = {
    $transaction: (fn: (tx: unknown) => unknown) => fn(fakeDb),
    asset: {
      findUniqueOrThrow: async ({ where }: { where: Row }) => {
        const row = tables.asset.find((a) => a.id === where.id);
        if (!row) throw new Error("asset not found");
        return { ...row };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        tables.asset.filter((a) => matches(a, where)),
      update: async ({
        where,
        data,
      }: {
        where: Row;
        data: Record<string, unknown>;
      }) => {
        const row = tables.asset.find((a) => a.id === where.id)!;
        applyData(row, data);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = tables.asset.filter((a) => matches(a, where));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
    },
    assetLocation: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        tables.assetLocation.filter((r) => matches(r, where)).map(withLocation),
      findFirst: async ({ where }: { where?: Record<string, unknown> }) => {
        const row = tables.assetLocation.find((r) => matches(r, where));
        return row ? withLocation(row) : null;
      },
      aggregate: async ({ where }: { where?: Record<string, unknown> }) => ({
        _sum: {
          quantity: sum(tables.assetLocation.filter((r) => matches(r, where))),
        },
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: newId("al"), assetKitId: null, ...data } as Row;
        tables.assetLocation.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: Row;
        data: Record<string, unknown>;
      }) => {
        const row = tables.assetLocation.find((r) => r.id === where.id)!;
        applyData(row, data);
        return row;
      },
      delete: async ({ where }: { where: Row }) => {
        tables.assetLocation = tables.assetLocation.filter(
          (r) => r.id !== where.id
        );
        return {};
      },
    },
    custody: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        tables.custody.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      findFirst: async ({ where }: { where?: Record<string, unknown> }) => {
        const row = tables.custody.find((r) => matches(r, where));
        return row ? { ...row } : null;
      },
      aggregate: async ({ where }: { where?: Record<string, unknown> }) => ({
        _sum: {
          quantity: sum(tables.custody.filter((r) => matches(r, where))),
        },
      }),
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        tables.custody.filter((r) => matches(r, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: newId("custody"),
          kitCustodyId: null,
          locationId: null,
          createdAt: new Date(),
          ...data,
        } as Row;
        // The operator unique index: one row per (asset, holder, source).
        const clash = tables.custody.find(
          (r) =>
            r.kitCustodyId === null &&
            r.assetId === row.assetId &&
            r.teamMemberId === row.teamMemberId &&
            r.locationId === row.locationId
        );
        if (clash) throw new Error("Custody_operator_unique violated");
        tables.custody.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: Row;
        data: Record<string, unknown>;
      }) => {
        const row = tables.custody.find((r) => r.id === where.id)!;
        applyData(row, data);
        return row;
      },
      delete: async ({ where }: { where: Row }) => {
        tables.custody = tables.custody.filter((r) => r.id !== where.id);
        return {};
      },
    },
    assetKit: {
      aggregate: async () => ({ _sum: { quantity: 0 } }),
    },
    bookingAsset: {
      aggregate: async () => ({ _sum: { quantity: 0 } }),
    },
    teamMember: {
      findFirst: async ({ where }: { where: Row }) =>
        tables.teamMember.find((t) => t.id === where.id) ?? null,
    },
    location: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        tables.location.find((l) => matches(l, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        tables.location.filter((l) => matches(l, where)),
    },
    user: {
      findUnique: async () => ({
        id: "user-1",
        firstName: "Ana",
        lastName: "Admin",
        displayName: null,
      }),
    },
    consumptionLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: newId("log"), ...data } as Row;
        tables.consumptionLog.push(row);
        return row;
      },
    },
  };

  return { tables, fakeDb, counter };
});

// why: the services under test run their reads and writes through `db`; the
// in-memory stand-in above lets each test assert on the rows they leave.
vi.mock("~/database/db.server", () => ({ db: fakeDb }));

// why: the real lock is a raw `SELECT ... FOR UPDATE`; return the asset row
// from the stand-in instead.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vi.fn(async (_tx: unknown, assetId: string) => {
    const row = tables.asset.find((a) => a.id === assetId);
    if (!row) throw new Error("asset not found");
    return { ...row };
  }),
}));

// why: the reservations guard's committed-peak math (custody, kits,
// bookings) has its own tests in `availability.server.test.ts`; these tests
// are about the location axis, so only that guard is stubbed.
vi.mock(
  "~/modules/asset/availability-primitives.server",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    assertAssetQuantityNotBelowReservations: vi.fn(),
  })
);

// why: activity events are asserted through the mock, not stored.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
  recordEvents: vi.fn().mockResolvedValue(undefined),
}));

// why: location timeline notes are asserted through the mock, not stored.
vi.mock("~/modules/location-note/service.server", () => ({
  createSystemLocationNote: vi.fn().mockResolvedValue({}),
}));

// why: asset notes are asserted through the mock, not stored.
vi.mock("~/modules/note/service.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createNote: vi.fn().mockResolvedValue({}),
}));

// why: the move writes its own "moved N units" notes after the commit; they
// are not what these tests are about.
vi.mock("~/modules/location/service.server", () => ({
  createLocationChangeNote: vi.fn().mockResolvedValue({}),
  createLocationsIfNotExists: vi.fn().mockResolvedValue([]),
}));

// why: the move looks up the acting user for its notes.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ana",
    lastName: "Admin",
    displayName: null,
  }),
}));

const { recordEvent } = await import("~/modules/activity-event/service.server");
const { createSystemLocationNote } = await import(
  "~/modules/location-note/service.server"
);

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

const ORG = "org-1";
const CAMERA_ROOM = "loc-camera-room";
const STUDIO = "loc-studio";
const FOREIGN = "loc-other-workspace";
const AHMED = "tm-ahmed";
const SARA = "tm-sara";

/** Resets the tables to one pool with the given total and placements. */
function seedPool({
  total,
  placements,
  consumptionType = "TWO_WAY",
}: {
  total: number;
  placements: Array<[string, number]>;
  consumptionType?: "ONE_WAY" | "TWO_WAY";
}) {
  counter.next = 1;
  tables.asset = [
    {
      id: "pool-1",
      title: "Spanner No 17",
      organizationId: ORG,
      type: "QUANTITY_TRACKED",
      quantity: total,
      unitOfMeasure: "pcs",
      consumptionType,
      status: "AVAILABLE",
    },
  ];
  tables.location = [
    { id: CAMERA_ROOM, name: "Camera Room", organizationId: ORG },
    { id: STUDIO, name: "Studio", organizationId: ORG },
    { id: FOREIGN, name: "Elsewhere", organizationId: "org-2" },
  ];
  tables.assetLocation = placements.map(([locationId, quantity], index) => ({
    id: `al-${index}`,
    assetId: "pool-1",
    locationId,
    organizationId: ORG,
    quantity,
    assetKitId: null,
    createdAt: new Date(2026, 0, index + 1),
  }));
  tables.custody = [];
  tables.consumptionLog = [];
  tables.teamMember = [
    { id: AHMED, organizationId: ORG, user: { id: "user-ahmed" } },
    { id: SARA, organizationId: ORG, user: { id: "user-sara" } },
  ];
}

/** Adds an operator custody row directly. */
function seedCustody(
  teamMemberId: string,
  locationId: string | null,
  quantity: number,
  createdAt = new Date("2026-09-01T00:00:00.000Z")
) {
  tables.custody.push({
    id: `custody-${teamMemberId}-${locationId ?? "none"}`,
    assetId: "pool-1",
    teamMemberId,
    locationId,
    quantity,
    kitCustodyId: null,
    createdAt,
  });
}

const placed = (locationId: string) =>
  (tables.assetLocation.find((r) => r.locationId === locationId)?.quantity as
    | number
    | undefined) ?? 0;

const custodyRows = () =>
  tables.custody
    .map((r) => [r.teamMemberId, r.locationId, r.quantity])
    .sort((a, b) => String(a).localeCompare(String(b)));

const assign = (
  args: Partial<Parameters<typeof checkOutQuantity>[0]> & { quantity: number }
) =>
  checkOutQuantity({
    assetId: "pool-1",
    teamMemberId: AHMED,
    userId: "user-1",
    organizationId: ORG,
    role: OrganizationRoles.ADMIN,
    ...args,
  });

const release = (
  args: Partial<Parameters<typeof releaseQuantity>[0]> & { quantity: number }
) =>
  releaseQuantity({
    assetId: "pool-1",
    teamMemberId: AHMED,
    userId: "user-1",
    organizationId: ORG,
    role: OrganizationRoles.ADMIN,
    ...args,
  });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ShelfError;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/*                                   Assign                                   */
/* -------------------------------------------------------------------------- */

describe("checkOutQuantity: where the units come from", () => {
  it("fills in the only placement of a pool at one location, silently", async () => {
    seedPool({ total: 4, placements: [[CAMERA_ROOM, 4]] });

    const { source } = await assign({ quantity: 2 });

    expect(custodyRows()).toEqual([[AHMED, CAMERA_ROOM, 2]]);
    expect(source).toMatchObject({
      locationId: CAMERA_ROOM,
      multiSource: false,
    });
    // Nothing new on screen for a pool at one location: no timeline note.
    expect(createSystemLocationNote).not.toHaveBeenCalled();
    // Placements never move for custody.
    expect(placed(CAMERA_ROOM)).toBe(4);
  });

  it("records nothing for a pool with no placements", async () => {
    seedPool({ total: 4, placements: [] });
    await assign({ quantity: 2 });
    expect(custodyRows()).toEqual([[AHMED, null, 2]]);
  });

  it("records the chosen location of a pool at two locations, on the row, the ledger and the event", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });

    const { source } = await assign({ quantity: 2, locationId: STUDIO });

    expect(custodyRows()).toEqual([[AHMED, STUDIO, 2]]);
    expect(source).toMatchObject({
      locationId: STUDIO,
      locationName: "Studio",
      explicit: true,
      multiSource: true,
    });
    expect(tables.consumptionLog).toEqual([
      expect.objectContaining({ category: "CHECKOUT", locationId: STUDIO }),
    ]);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CUSTODY_ASSIGNED",
        locationId: STUDIO,
      }),
      expect.anything()
    );
    expect(createSystemLocationNote).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: STUDIO })
    );
    // The location keeps its count: custody is not a move.
    expect(placed(STUDIO)).toBe(2);
  });

  it("caps the quantity at what the location has left", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });

    const error = await refusal(
      assign({ quantity: 3, locationId: CAMERA_ROOM })
    );
    expect(error.status).toBe(400);
    expect(error.message).toBe("Camera Room has only 2 pcs.");
    expect(tables.custody).toEqual([]);
  });

  it("counts what is already in custody from the location against the cap", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(SARA, CAMERA_ROOM, 1);

    const error = await refusal(
      assign({ quantity: 2, locationId: CAMERA_ROOM })
    );
    expect(error.message).toBe(
      "Camera Room has 2 pcs and 1 is already in custody."
    );

    // The one left can still be taken.
    await assign({ quantity: 1, locationId: CAMERA_ROOM });
    expect(custodyRows()).toContainEqual([AHMED, CAMERA_ROOM, 1]);
  });

  it("takes from the unplaced units when asked, and only while there are any", async () => {
    seedPool({ total: 7, placements: [[CAMERA_ROOM, 4]] });
    // The web picker posts the word; JSON clients may send "" or null.
    await assign({ quantity: 3, locationId: "unplaced" });
    expect(custodyRows()).toEqual([[AHMED, null, 3]]);

    seedPool({ total: 4, placements: [[CAMERA_ROOM, 4]] });
    const error = await refusal(assign({ quantity: 1, locationId: "" }));
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/no unplaced units/);
  });

  it("refuses a location the pool is not placed at, including another workspace's", async () => {
    seedPool({ total: 4, placements: [[CAMERA_ROOM, 4]] });

    for (const locationId of [STUDIO, FOREIGN, "not-a-location"]) {
      const error = await refusal(assign({ quantity: 1, locationId }));
      expect(error.status).toBe(400);
    }
    expect(tables.custody).toEqual([]);
  });

  it("never refuses an older client that sends no location", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });

    // 3 is more than either location holds, but nothing was asked.
    await assign({ quantity: 3 });
    expect(custodyRows()).toEqual([[AHMED, null, 3]]);
  });

  it("keeps one row per person per location", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });

    await assign({ quantity: 1, locationId: CAMERA_ROOM });
    await assign({ quantity: 1, locationId: CAMERA_ROOM });
    await assign({ quantity: 1, locationId: STUDIO });

    expect(custodyRows()).toEqual([
      [AHMED, CAMERA_ROOM, 2],
      [AHMED, STUDIO, 1],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Release                                   */
/* -------------------------------------------------------------------------- */

describe("releaseQuantity: per source", () => {
  it("releases from the named source only", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 2);
    seedCustody(AHMED, STUDIO, 1);

    await release({ quantity: 1, locationId: STUDIO });

    expect(custodyRows()).toEqual([[AHMED, CAMERA_ROOM, 2]]);
    expect(tables.consumptionLog).toEqual([
      expect.objectContaining({ category: "RETURN", locationId: STUDIO }),
    ]);
    // Returned units never move a placement.
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([2, 2]);
  });

  it("draws the largest row first when an older client names no source", async () => {
    seedPool({
      total: 6,
      placements: [
        [CAMERA_ROOM, 3],
        [STUDIO, 3],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 1);
    seedCustody(AHMED, STUDIO, 3);

    await release({ quantity: 3 });

    expect(custodyRows()).toEqual([[AHMED, CAMERA_ROOM, 1]]);
  });

  it("refuses more than the person holds from that source", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 2);

    const tooMany = await refusal(
      release({ quantity: 3, locationId: CAMERA_ROOM })
    );
    expect(tooMany.status).toBe(400);

    const wrongSource = await refusal(
      release({ quantity: 1, locationId: STUDIO })
    );
    expect(wrongSource.status).toBe(404);
  });

  it("takes used-up units off the recorded location, not the other one", async () => {
    // 100 glove boxes: 60 at Camera Room, 40 at Studio. Ahmed took 10 from Studio.
    seedPool({
      total: 100,
      placements: [
        [CAMERA_ROOM, 60],
        [STUDIO, 40],
      ],
      consumptionType: "ONE_WAY",
    });
    seedCustody(AHMED, STUDIO, 10);

    const result = await release({ quantity: 10 });

    expect(result.consumed).toBe(10);
    expect(tables.asset[0].quantity).toBe(90);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([60, 30]);
    expect(tables.consumptionLog).toEqual([
      expect.objectContaining({
        category: "CONSUME",
        quantity: 10,
        locationId: STUDIO,
      }),
    ]);
    expect(createSystemLocationNote).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: STUDIO })
    );
  });

  it("lets the unplaced units absorb a consume with no recorded location", async () => {
    seedPool({
      total: 10,
      placements: [
        [CAMERA_ROOM, 4],
        [STUDIO, 4],
      ],
      consumptionType: "ONE_WAY",
    });
    seedCustody(AHMED, null, 2);

    await release({ quantity: 2 });

    expect(tables.asset[0].quantity).toBe(8);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([4, 4]);
  });

  it("applies per-location lines with their own used-up counts", async () => {
    seedPool({
      total: 10,
      placements: [
        [CAMERA_ROOM, 5],
        [STUDIO, 5],
      ],
      consumptionType: "ONE_WAY",
    });
    seedCustody(AHMED, CAMERA_ROOM, 2);
    seedCustody(AHMED, STUDIO, 3);

    const result = await release({
      quantity: 4,
      sources: [
        { locationId: CAMERA_ROOM, quantity: 2, consumed: 1 },
        { locationId: STUDIO, quantity: 2, consumed: 2 },
      ],
    });

    expect(result).toMatchObject({ consumed: 3, returned: 1 });
    expect(custodyRows()).toEqual([[AHMED, STUDIO, 1]]);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([4, 3]);
    expect(tables.asset[0].quantity).toBe(7);
    expect(
      tables.consumptionLog.map((l) => [l.category, l.locationId, l.quantity])
    ).toEqual([
      ["CONSUME", CAMERA_ROOM, 1],
      ["RETURN", CAMERA_ROOM, 1],
      ["CONSUME", STUDIO, 2],
    ]);
  });

  it("refuses lines that do not add up to the quantity", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 2);
    seedCustody(AHMED, STUDIO, 1);

    const error = await refusal(
      release({
        quantity: 3,
        sources: [{ locationId: CAMERA_ROOM, quantity: 1 }],
      })
    );
    expect(error.status).toBe(400);
    expect(tables.custody).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/*                                   Adjust                                   */
/* -------------------------------------------------------------------------- */

describe("adjustQuantity: at a location", () => {
  it("restocks at the chosen location", async () => {
    seedPool({
      total: 90,
      placements: [
        [CAMERA_ROOM, 60],
        [STUDIO, 30],
      ],
    });

    await adjustQuantity({
      assetId: "pool-1",
      quantity: 5,
      category: "RESTOCK",
      direction: "add",
      userId: "user-1",
      organizationId: ORG,
      locationId: STUDIO,
    });

    expect(tables.asset[0].quantity).toBe(95);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([60, 35]);
    expect(tables.consumptionLog).toEqual([
      expect.objectContaining({ category: "RESTOCK", locationId: STUDIO }),
    ]);
  });

  it("records a loss at a location, capped by what it has left", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(AHMED, STUDIO, 1);

    const error = await refusal(
      adjustQuantity({
        assetId: "pool-1",
        quantity: 2,
        category: "LOSS",
        direction: "subtract",
        userId: "user-1",
        organizationId: ORG,
        locationId: STUDIO,
      })
    );
    expect(error.message).toBe("Studio has 2 pcs and 1 is in custody.");

    await adjustQuantity({
      assetId: "pool-1",
      quantity: 1,
      category: "LOSS",
      direction: "subtract",
      userId: "user-1",
      organizationId: ORG,
      locationId: STUDIO,
    });
    expect(tables.asset[0].quantity).toBe(3);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([2, 1]);
  });

  it("does not dead-end a loss after a consume (the two-location glove case)", async () => {
    seedPool({
      total: 100,
      placements: [
        [CAMERA_ROOM, 60],
        [STUDIO, 40],
      ],
      consumptionType: "ONE_WAY",
    });
    seedCustody(AHMED, STUDIO, 10);
    await release({ quantity: 10 });

    // Before source tracking this LOSS was refused ("Lower the placements
    // first") because the consume had left the placements at 100 of 90.
    await adjustQuantity({
      assetId: "pool-1",
      quantity: 5,
      category: "LOSS",
      direction: "subtract",
      userId: "user-1",
      organizationId: ORG,
      locationId: CAMERA_ROOM,
    });

    expect(tables.asset[0].quantity).toBe(85);
    expect([placed(CAMERA_ROOM), placed(STUDIO)]).toEqual([55, 30]);
  });

  it("keeps the placement guard for a total-only loss", async () => {
    seedPool({ total: 4, placements: [[CAMERA_ROOM, 4]] });

    const error = await refusal(
      adjustQuantity({
        assetId: "pool-1",
        quantity: 1,
        category: "LOSS",
        direction: "subtract",
        userId: "user-1",
        organizationId: ORG,
      })
    );
    expect(error.message).toMatch(/Lower the placements first/);
  });
});

/* -------------------------------------------------------------------------- */
/*                                  Re-home                                   */
/* -------------------------------------------------------------------------- */

describe("moveAssetLocationUnits: custody follows the units", () => {
  it("moves units not in custody first", async () => {
    seedPool({
      total: 8,
      placements: [
        [CAMERA_ROOM, 4],
        [STUDIO, 4],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 2);

    await moveAssetLocationUnits({
      assetId: "pool-1",
      organizationId: ORG,
      userId: "user-1",
      fromLocationId: CAMERA_ROOM,
      toLocationId: STUDIO,
      quantity: 2,
    });

    expect(custodyRows()).toEqual([[AHMED, CAMERA_ROOM, 2]]);
  });

  it("takes the excess custody to the destination, merging into an existing row", async () => {
    seedPool({
      total: 8,
      placements: [
        [CAMERA_ROOM, 4],
        [STUDIO, 4],
      ],
    });
    seedCustody(AHMED, CAMERA_ROOM, 3);
    seedCustody(AHMED, STUDIO, 1);

    await moveAssetLocationUnits({
      assetId: "pool-1",
      organizationId: ORG,
      userId: "user-1",
      fromLocationId: CAMERA_ROOM,
      toLocationId: STUDIO,
      quantity: 3,
    });

    // Camera Room keeps 1 unit, so 1 of Ahmed's 3 stays there.
    expect(custodyRows()).toEqual([
      [AHMED, CAMERA_ROOM, 1],
      [AHMED, STUDIO, 3],
    ]);
  });
});

describe("rehomeCustodyForPlacementChanges: many pools at once", () => {
  it("re-homes only the pools whose placements lost units in custody", async () => {
    seedPool({
      total: 4,
      placements: [
        [CAMERA_ROOM, 2],
        [STUDIO, 2],
      ],
    });
    seedCustody(AHMED, STUDIO, 2);
    const tx = (await import("~/database/db.server")).db as never;

    const before = await loadCustodySourcesForAssets(tx, [
      { id: "pool-1", total: 4 },
      { id: "pool-without-custody", total: 9 },
    ]);
    // Only pools with custody are read in full.
    expect(Array.from(before.keys())).toEqual(["pool-1"]);

    // The location page removes the pool from Studio.
    tables.assetLocation = tables.assetLocation.filter(
      (r) => r.locationId !== STUDIO
    );

    const results = await rehomeCustodyForPlacementChanges(tx, {
      before,
      totals: new Map([["pool-1", 4]]),
      destinationFor: () => null,
    });

    expect(results.map((r) => [r.assetId, r.result.moves.length])).toEqual([
      ["pool-1", 1],
    ]);
    expect(custodyRows()).toEqual([[AHMED, null, 2]]);
  });
});
