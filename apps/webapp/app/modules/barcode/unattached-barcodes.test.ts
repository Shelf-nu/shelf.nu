// @vitest-environment node
/**
 * The rule for unattached barcodes, run over every barcode-service write path.
 *
 * A barcode value is taken only while its row is attached to an asset or a
 * kit. A row left behind by a deleted asset or kit (both links null) is free:
 * the next writer takes the value with the type it submitted. A value held by
 * a live asset or kit is refused, and the error names that asset or kit.
 *
 * The service runs against an in-memory `Barcode` table that enforces the
 * `[organizationId, value]` unique index, so each case asserts the rows that
 * are left, not the queries that were sent.
 *
 * @see {@link file://./service.server.ts} `releaseUnattachedBarcodes`
 * @see {@link file://./unattached-barcodes.db.test.ts} the same rule through
 *   the asset, kit and import services on a real database
 */

import { BarcodeType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { VALIDATION_ERROR } from "~/utils/error";
import {
  createBarcode,
  createBarcodes,
  updateBarcode,
  updateBarcodes,
  validateBarcodeUniqueness,
} from "./service.server";

/** One row of the in-memory `Barcode` table. */
type Row = {
  id: string;
  type: BarcodeType;
  value: string;
  organizationId: string;
  assetId: string | null;
  kitId: string | null;
};

type Where = Record<string, unknown>;

const table = vi.hoisted(() => ({
  rows: [] as Row[],
  nextId: 1,
  /** Titles and names the uniqueness check reads through its `include`. */
  assetTitles: { "asset-live": "ZZ Live Asset" } as Record<string, string>,
  kitNames: { "kit-live": "ZZ Live Kit" } as Record<string, string>,
}));

// why: the rule is about which rows exist after a write, so the database is
// replaced by a table that keeps rows and enforces the unique index.
vi.mock("~/database/db.server", () => {
  /** Evaluates the subset of Prisma `where` the barcode service uses. */
  const matches = (row: Row, where: Where): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Where[]).some((branch) => matches(row, branch));
      }
      const actual = row[key as keyof Row];
      if (condition !== null && typeof condition === "object") {
        const operator = condition as {
          in?: unknown[];
          not?: unknown;
          notIn?: unknown[];
          mode?: "insensitive";
        };
        if ("notIn" in operator) return !operator.notIn!.includes(actual);
        if ("in" in operator) {
          if (operator.mode !== "insensitive") {
            return operator.in!.includes(actual);
          }
          return operator.in!.some(
            (candidate) =>
              String(candidate).toLowerCase() === String(actual).toLowerCase()
          );
        }
        if ("not" in operator) return actual !== operator.not;
      }
      return actual === condition;
    });

  const assertValueIsFree = (candidate: Row) => {
    const taken = table.rows.some(
      (row) =>
        row.id !== candidate.id &&
        row.organizationId === candidate.organizationId &&
        row.value === candidate.value
    );
    if (taken) {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["organizationId", "value"] },
      });
    }
  };

  const insert = (data: Partial<Row>) => {
    const row: Row = {
      id: `row-${table.nextId++}`,
      type: data.type!,
      value: data.value!,
      organizationId: data.organizationId!,
      assetId: data.assetId ?? null,
      kitId: data.kitId ?? null,
    };
    assertValueIsFree(row);
    table.rows.push(row);
    return row;
  };

  const barcode = {
    create: ({ data }: { data: Partial<Row> }) =>
      Promise.resolve().then(() => insert(data)),
    createMany: ({ data }: { data: Partial<Row>[] }) =>
      Promise.resolve().then(() => ({ count: data.map(insert).length })),
    update: ({ where, data }: { where: Where; data: Partial<Row> }) =>
      Promise.resolve().then(() => {
        const row = table.rows.find((r) => matches(r, where))!;
        assertValueIsFree({ ...row, ...data });
        return Object.assign(row, data);
      }),
    deleteMany: ({ where }: { where: Where }) =>
      Promise.resolve().then(() => {
        const before = table.rows.length;
        table.rows = table.rows.filter((row) => !matches(row, where));
        return { count: before - table.rows.length };
      }),
    findMany: ({ where }: { where: Where }) =>
      Promise.resolve(
        table.rows
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            asset: row.assetId
              ? { title: table.assetTitles[row.assetId] }
              : null,
            kit: row.kitId ? { name: table.kitNames[row.kitId] } : null,
          }))
      ),
  };

  /** The org guards ask for ids in a workspace; every id here belongs. */
  const findAllRequestedIds = ({
    where,
  }: {
    where: { id: { in: string[] } };
  }) => Promise.resolve(where.id.in.map((id) => ({ id })));

  const db = {
    barcode,
    asset: { findMany: findAllRequestedIds },
    kit: { findMany: findAllRequestedIds },
    // Batch entries are awaited in order, as a real batch runs them. When
    // any step throws, the table goes back to what it held before, as a
    // real transaction rolls back.
    $transaction: async (work: unknown) => {
      const snapshot = {
        rows: table.rows.map((row) => ({ ...row })),
        nextId: table.nextId,
      };
      try {
        if (typeof work === "function") {
          return await (work as (tx: unknown) => unknown)(db);
        }
        const results = [];
        for (const operation of work as Promise<unknown>[]) {
          results.push(await operation);
        }
        return results;
      } catch (cause) {
        table.rows = snapshot.rows;
        table.nextId = snapshot.nextId;
        throw cause;
      }
    },
  };
  return { db };
});

const ORG = "org-1";
const VALUE = "ZZ-LABEL-1";

/** Puts a row straight into the table, as earlier activity left it. */
function seed(row: Partial<Row> & Pick<Row, "id">): Row {
  const seeded: Row = {
    type: BarcodeType.Code128,
    value: VALUE,
    organizationId: ORG,
    assetId: null,
    kitId: null,
    ...row,
  };
  table.rows.push(seeded);
  return seeded;
}

/** Every row in `organizationId` that carries `value`. */
function holders(value = VALUE, organizationId = ORG) {
  return table.rows.filter(
    (row) => row.organizationId === organizationId && row.value === value
  );
}

/** The per-field messages of a rejected write. */
async function fieldErrors(write: Promise<unknown>) {
  const error = await write.then(
    () => undefined,
    (cause: { additionalData?: Record<string, unknown> }) => cause
  );
  return error?.additionalData?.[VALIDATION_ERROR];
}

type Target = { assetId: string } | { kitId: string };

/**
 * A way a barcode value reaches the table. `seedOwn` puts the target's
 * existing barcode in place for the paths that edit one.
 */
type WritePath = {
  name: string;
  target: Target;
  seedOwn?: () => void;
  write: (type: BarcodeType, value: string) => Promise<unknown>;
};

const asset: Target = { assetId: "asset-new" };
const kit: Target = { kitId: "kit-new" };
const base = { organizationId: ORG, userId: "user-1" };

const WRITE_PATHS: WritePath[] = [
  {
    name: "asset page, add barcode (createBarcode)",
    target: asset,
    write: (type, value) => createBarcode({ ...base, ...asset, type, value }),
  },
  {
    name: "kit page, add barcode (createBarcode)",
    target: kit,
    write: (type, value) => createBarcode({ ...base, ...kit, type, value }),
  },
  {
    name: "asset, several at once (createBarcodes)",
    target: asset,
    write: (type, value) =>
      createBarcodes({ ...base, ...asset, barcodes: [{ type, value }] }),
  },
  {
    name: "asset edit form, new barcode (updateBarcodes)",
    target: asset,
    write: (type, value) =>
      updateBarcodes({ ...base, ...asset, barcodes: [{ type, value }] }),
  },
  {
    name: "kit edit form, new barcode (updateBarcodes)",
    target: kit,
    write: (type, value) =>
      updateBarcodes({ ...base, ...kit, barcodes: [{ type, value }] }),
  },
  {
    name: "asset edit form, own barcode changes value (updateBarcodes)",
    target: asset,
    seedOwn: () => seed({ id: "own", value: "ZZ-OWN-1", ...asset }),
    write: (type, value) =>
      updateBarcodes({
        ...base,
        ...asset,
        barcodes: [{ id: "own", type, value }],
      }),
  },
  {
    name: "kit edit form, own barcode changes value (updateBarcodes)",
    target: kit,
    seedOwn: () => seed({ id: "own", value: "ZZ-OWN-1", ...kit }),
    write: (type, value) =>
      updateBarcodes({
        ...base,
        ...kit,
        barcodes: [{ id: "own", type, value }],
      }),
  },
  {
    name: "single barcode changes value (updateBarcode)",
    target: asset,
    seedOwn: () => seed({ id: "own", value: "ZZ-OWN-1", ...asset }),
    write: (type, value) =>
      updateBarcode({ id: "own", ...asset, organizationId: ORG, type, value }),
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  table.rows = [];
  table.nextId = 1;
});

describe.each(WRITE_PATHS)("$name", ({ target, seedOwn, write }) => {
  const attachedTo = { assetId: null, kitId: null, ...target };

  it("takes a value held by an unattached barcode", async () => {
    seedOwn?.();
    seed({ id: "left-behind" });

    await write(BarcodeType.Code128, VALUE);

    expect(holders()).toEqual([
      expect.objectContaining({ ...attachedTo, type: BarcodeType.Code128 }),
    ]);
  });

  it("takes it with the submitted type, not the type it was left with", async () => {
    seedOwn?.();
    seed({ id: "left-behind", type: BarcodeType.Code128 });

    await write(BarcodeType.DataMatrix, VALUE);

    expect(holders()).toEqual([
      expect.objectContaining({ ...attachedTo, type: BarcodeType.DataMatrix }),
    ]);
  });

  it("takes a value whose unattached barcode differs only in case", async () => {
    seedOwn?.();
    seed({ id: "left-behind", value: VALUE });

    await write(BarcodeType.ExternalQR, VALUE.toLowerCase());

    expect(holders()).toEqual([]);
    expect(holders(VALUE.toLowerCase())).toEqual([
      expect.objectContaining({ ...attachedTo, type: BarcodeType.ExternalQR }),
    ]);
  });

  it("refuses a value held by a live asset and names the asset", async () => {
    seedOwn?.();
    const live = seed({ id: "live", assetId: "asset-live" });

    const errors = await fieldErrors(write(BarcodeType.Code128, VALUE));

    expect(errors).toEqual({
      "barcodes[0].value": {
        message: 'This barcode value is already used by "ZZ Live Asset"',
      },
    });
    expect(holders()).toEqual([live]);
  });

  it("refuses a value held by a live kit and names the kit", async () => {
    seedOwn?.();
    const live = seed({ id: "live", kitId: "kit-live" });

    const errors = await fieldErrors(write(BarcodeType.Code128, VALUE));

    expect(errors).toEqual({
      "barcodes[0].value": {
        message: 'This barcode value is already used by "ZZ Live Kit"',
      },
    });
    expect(holders()).toEqual([live]);
  });

  it("leaves another workspace's unattached barcode with the same value alone", async () => {
    seedOwn?.();
    const foreign = seed({ id: "foreign", organizationId: "org-2" });

    await write(BarcodeType.Code128, VALUE);

    expect(holders(VALUE, "org-2")).toEqual([foreign]);
  });

  it("leaves unattached barcodes with other values alone", async () => {
    seedOwn?.();
    const other = seed({ id: "other", value: "ZZ-OTHER-1" });

    await write(BarcodeType.Code128, VALUE);

    expect(holders("ZZ-OTHER-1")).toEqual([other]);
  });
});

describe("validateBarcodeUniqueness", () => {
  it("does not report a value held only by an unattached barcode", async () => {
    seed({ id: "left-behind" });

    await expect(
      validateBarcodeUniqueness(
        [{ type: BarcodeType.Code128, value: VALUE }],
        ORG
      )
    ).resolves.toBeUndefined();
  });
});

describe("a write that fails after the release", () => {
  it("createBarcode keeps the unattached barcode", async () => {
    const leftBehind = seed({ id: "left-behind" });
    // why: a single create cannot clash with a value the release just freed,
    // so the write after the release is made to fail on its own.
    vi.spyOn(db.barcode, "create").mockImplementationOnce(
      // why: the mocked delegate returns a plain promise, not a PrismaPromise.
      () => Promise.reject(new Error("ZZ write failed")) as never
    );

    await expect(
      createBarcode({
        ...base,
        ...asset,
        type: BarcodeType.Code128,
        value: VALUE,
      })
    ).rejects.toThrow();

    expect(holders()).toEqual([leftBehind]);
  });

  it("updateBarcodes keeps the unattached barcode when another value is taken", async () => {
    const leftBehind = seed({ id: "left-behind" });
    const live = seed({
      id: "live",
      value: "ZZ-LIVE-1",
      assetId: "asset-live",
    });

    await expect(
      updateBarcodes({
        ...base,
        ...asset,
        barcodes: [
          { type: BarcodeType.Code128, value: VALUE },
          { type: BarcodeType.Code128, value: "ZZ-LIVE-1" },
        ],
      })
    ).rejects.toThrow();

    expect(holders()).toEqual([leftBehind]);
    expect(holders("ZZ-LIVE-1")).toEqual([live]);
  });
});

describe("a write that updates an unattached barcode by id", () => {
  it("updateBarcode keeps the row it updates", async () => {
    seed({ id: "left-behind" });

    await updateBarcode({
      id: "left-behind",
      organizationId: ORG,
      type: BarcodeType.DataMatrix,
      value: VALUE,
    });

    expect(holders()).toEqual([
      expect.objectContaining({
        id: "left-behind",
        type: BarcodeType.DataMatrix,
      }),
    ]);
  });

  it("updateBarcodes keeps the row it updates", async () => {
    seed({ id: "left-behind" });

    await updateBarcodes({
      ...base,
      ...asset,
      barcodes: [
        { id: "left-behind", type: BarcodeType.DataMatrix, value: VALUE },
      ],
    });

    expect(holders()).toEqual([
      expect.objectContaining({
        id: "left-behind",
        type: BarcodeType.DataMatrix,
      }),
    ]);
  });
});

describe("updateBarcode without a new value", () => {
  it.each([
    { name: "type only", change: { type: BarcodeType.DataMatrix } },
    { name: "empty", change: {} },
  ])("sends no delete ($name)", async ({ change }) => {
    seed({ id: "own", value: "ZZ-OWN-1", assetId: "asset-new" });
    const leftBehind = seed({ id: "left-behind" });
    const deleteMany = vi.spyOn(db.barcode, "deleteMany");

    await updateBarcode({ id: "own", organizationId: ORG, ...change });

    expect(deleteMany).not.toHaveBeenCalled();
    expect(holders()).toEqual([leftBehind]);
  });
});
