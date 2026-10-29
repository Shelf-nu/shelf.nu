// @vitest-environment node
/* eslint-disable @typescript-eslint/require-await -- why: the in-memory table
   answers with promises, as Prisma does, without awaiting anything itself */
/**
 * A workspace's PDF documents: what a workspace starts with, the one-default
 * and keep-one rules, which document a print gets, and which custom fields a
 * document may name.
 *
 * Runs against an in-memory `pdfDocument` table that honours the same
 * workspace scoping and unique names as the real one, so the tests read what
 * the service leaves behind rather than which calls it made.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING_CHECKLIST_CONFIG, CHECKOUT_RECEIPT_CONFIG } from "./config";
import {
  canCustomizePdfDocuments,
  createPdfDocument,
  deletePdfDocument,
  duplicatePdfDocument,
  getPdfDocuments,
  resolvePdfDocumentForPrint,
  setDefaultPdfDocument,
  updatePdfDocument,
} from "./service.server";

type Row = {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  config: unknown;
  isDefault: boolean;
  createdAt: Date;
};

type Where = {
  id?: string | { not: string } | { in: string[] };
  organizationId?: string;
  kind?: string;
  isDefault?: boolean;
  name?: { equals: string; mode: "insensitive" };
};

const store = vi.hoisted(() => ({
  rows: [] as Row[],
  customFields: [] as {
    id: string;
    organizationId: string;
    type: string;
    deletedAt: Date | null;
  }[],
  seq: 0,
  /** Workspaces whose paid documents were already given. */
  seeded: new Set<string>(),
}));

function matches(row: Row, where: Where = {}) {
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if (where.id && typeof where.id === "object") {
    if ("not" in where.id && row.id === where.id.not) return false;
    if ("in" in where.id && !where.id.in.includes(row.id)) return false;
  }
  if (where.organizationId && row.organizationId !== where.organizationId)
    return false;
  if (where.kind && row.kind !== where.kind) return false;
  if (where.isDefault !== undefined && row.isDefault !== where.isDefault)
    return false;
  if (where.name && row.name.toLowerCase() !== where.name.equals.toLowerCase())
    return false;
  return true;
}

function assertUnique() {
  const names = new Set<string>();
  const defaults = new Set<string>();
  for (const row of store.rows) {
    const nameKey = `${row.organizationId}|${row.kind}|${row.name}`;
    if (names.has(nameKey)) {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    }
    names.add(nameKey);
    if (row.isDefault) {
      const key = `${row.organizationId}|${row.kind}`;
      if (defaults.has(key)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      defaults.add(key);
    }
  }
}

/** Applies a write, and rolls it back when it breaks a unique index. */
function write<T>(apply: () => T): T {
  const before = store.rows.map((row) => ({ ...row }));
  try {
    const result = apply();
    assertUnique();
    return result;
  } catch (cause) {
    store.rows = before;
    throw cause;
  }
}

function sorted(rows: Row[]) {
  return [...rows].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
}

const pdfDocument = vi.hoisted(() => ({
  count: vi.fn(
    async ({ where }: { where: Where }) =>
      store.rows.filter((row) => matches(row, where)).length
  ),
  findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
    sorted(store.rows.filter((row) => matches(row, where))).slice(
      0,
      take ?? Infinity
    )
  ),
  findFirst: vi.fn(
    async ({ where }: { where: Where }) =>
      store.rows.find((row) => matches(row, where)) ?? null
  ),
  create: vi.fn(
    async ({
      data,
    }: {
      data: Omit<Row, "id" | "createdAt" | "isDefault"> & {
        isDefault?: boolean;
      };
    }) =>
      write(() => {
        const row: Row = {
          ...data,
          isDefault: data.isDefault ?? false,
          id: `document-${++store.seq}`,
          createdAt: new Date(store.seq * 1000),
        };
        store.rows.push(row);
        return row;
      })
  ),
  createMany: vi.fn(
    async ({ data }: { data: Omit<Row, "id" | "createdAt">[] }) => {
      for (const item of data) {
        try {
          await pdfDocument.create({ data: item });
        } catch {
          // skipDuplicates
        }
      }
    }
  ),
  update: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) =>
    write(() => {
      const row = store.rows.find((r) => matches(r, where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data);
      return row;
    })
  ),
  updateMany: vi.fn(
    async ({ where, data }: { where: Where; data: Partial<Row> }) =>
      write(() => {
        store.rows
          .filter((r) => matches(r, where))
          .forEach((r) => Object.assign(r, data));
      })
  ),
  delete: vi.fn(async ({ where }: { where: Where }) => {
    const index = store.rows.findIndex((r) => matches(r, where));
    if (index < 0) throw new Error("Record not found");
    store.rows.splice(index, 1);
  }),
}));

const customField = vi.hoisted(() => ({
  findMany: vi.fn(
    async ({
      where,
    }: {
      where: { id: { in: string[] }; organizationId: string };
    }) =>
      store.customFields.filter(
        (f) =>
          where.id.in.includes(f.id) &&
          f.organizationId === where.organizationId
      )
  ),
  count: vi.fn(
    async ({
      where,
    }: {
      where: {
        id: { in: string[] };
        organizationId: string;
      };
    }) =>
      store.customFields.filter(
        (f) =>
          where.id.in.includes(f.id) &&
          f.organizationId === where.organizationId &&
          f.deletedAt === null
      ).length
  ),
}));

const organization = vi.hoisted(() => ({
  findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
    paidPdfDocumentsSeededAt: store.seeded.has(where.id) ? new Date() : null,
    pdfDocuments: sorted(
      store.rows.filter((row) => row.organizationId === where.id)
    ),
  })),
  updateMany: vi.fn(async ({ where }: { where: { id: string } }) => {
    store.seeded.add(where.id);
  }),
}));

// why: the service's rules are about what the table holds; an in-memory table
// with the real scoping and unique indexes keeps the tests off a database.
vi.mock("~/database/db.server", () => {
  const db = {
    pdfDocument,
    customField,
    organization,
    // why: the row lock has no effect on a single-threaded in-memory table.
    $queryRaw: async () => [],
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db };
});

// why: the tier gate opens for everyone when premium features are off; each
// test picks the switch.
const premium = vi.hoisted(() => ({ enabled: true }));
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<{ config: Record<string, unknown> }>();
  return {
    config: {
      ...actual.config,
      get enablePremiumFeatures() {
        return premium.enabled;
      },
    },
  };
});

const ORG = "org-1";

beforeEach(() => {
  store.rows = [];
  store.customFields = [];
  store.seq = 0;
  store.seeded = new Set();
  premium.enabled = true;
});

function documentsOf(organizationId = ORG) {
  return sorted(store.rows.filter((r) => r.organizationId === organizationId));
}

describe("PDF documents: what a workspace starts with", () => {
  it("gives a workspace with no documents the Checklist (default) and Check-out receipt", async () => {
    const documents = await getPdfDocuments({ organizationId: ORG });

    expect(
      documents.map(({ name, isDefault }) => ({ name, isDefault }))
    ).toEqual([
      { name: "Checklist", isDefault: true },
      { name: "Check-out receipt", isDefault: false },
    ]);
    expect(documents[0].config).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(documents[1].config).toEqual(CHECKOUT_RECEIPT_CONFIG);
  });

  it("gives a workspace that upgrades its Check-out receipt once, and never seeds a deleted one back", async () => {
    // A free workspace: the Checklist only, paid documents never given.
    store.rows.push({
      id: "free-checklist",
      organizationId: ORG,
      name: "Checklist",
      kind: "BOOKING",
      config: BOOKING_CHECKLIST_CONFIG,
      isDefault: true,
      createdAt: new Date(0),
    });

    const upgraded = await getPdfDocuments({ organizationId: ORG });
    expect(upgraded.map(({ name, isDefault }) => [name, isDefault])).toEqual([
      ["Checklist", true],
      ["Check-out receipt", false],
    ]);

    await deletePdfDocument({
      organizationId: ORG,
      documentId: upgraded[1].id,
    });
    const later = await getPdfDocuments({ organizationId: ORG });
    expect(later.map((d) => d.name)).toEqual(["Checklist"]);
  });

  it("does not add the built-in documents again to a workspace that has documents", async () => {
    await getPdfDocuments({ organizationId: ORG });
    await getPdfDocuments({ organizationId: ORG });

    expect(documentsOf()).toHaveLength(2);
  });
});

describe("PDF documents: the default and the last document", () => {
  it("refuses to delete the last document", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const [checklist, handover] = documentsOf();
    await deletePdfDocument({ organizationId: ORG, documentId: handover.id });

    await expect(
      deletePdfDocument({ organizationId: ORG, documentId: checklist.id })
    ).rejects.toMatchObject({ status: 400, title: "Keep one document" });
    expect(documentsOf().map((s) => s.name)).toEqual(["Checklist"]);
  });

  it("makes the oldest remaining document the default when the default is deleted", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const [checklist] = documentsOf();
    await createPdfDocument({ organizationId: ORG, name: "Client quote" });

    await deletePdfDocument({ organizationId: ORG, documentId: checklist.id });

    expect(
      documentsOf().map(({ name, isDefault }) => ({ name, isDefault }))
    ).toEqual([
      { name: "Check-out receipt", isDefault: true },
      { name: "Client quote", isDefault: false },
    ]);
  });

  it("moves the default, keeping exactly one", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const handover = documentsOf()[1];

    await setDefaultPdfDocument({
      organizationId: ORG,
      documentId: handover.id,
    });

    expect(
      documentsOf()
        .filter((s) => s.isDefault)
        .map((s) => s.name)
    ).toEqual(["Check-out receipt"]);
  });

  it("names a copy after its source, never the default", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const checklist = documentsOf()[0];

    await duplicatePdfDocument({
      organizationId: ORG,
      documentId: checklist.id,
    });
    await duplicatePdfDocument({
      organizationId: ORG,
      documentId: checklist.id,
    });

    const copies = documentsOf().filter((s) => s.name.startsWith("Copy of"));
    expect(copies.map((s) => [s.name, s.isDefault])).toEqual([
      ["Copy of Checklist", false],
      ["Copy of Checklist (2)", false],
    ]);
  });

  it("refuses a name another document of the workspace has, whatever its case", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const handover = documentsOf()[1];

    await expect(
      createPdfDocument({ organizationId: ORG, name: "checklist" })
    ).rejects.toMatchObject({ status: 400, title: "Name already used" });
    await expect(
      updatePdfDocument({
        organizationId: ORG,
        documentId: handover.id,
        name: "CHECKLIST",
        config: CHECKOUT_RECEIPT_CONFIG,
      })
    ).rejects.toMatchObject({ status: 400, title: "Name already used" });
    expect(documentsOf().map((s) => s.name)).toEqual([
      "Checklist",
      "Check-out receipt",
    ]);
  });

  it("keeps a copy's name within the name limit", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const long = await createPdfDocument({
      organizationId: ORG,
      name: "A".repeat(60),
    });

    await duplicatePdfDocument({ organizationId: ORG, documentId: long!.id });
    await duplicatePdfDocument({ organizationId: ORG, documentId: long!.id });

    const copies = documentsOf()
      .map((s) => s.name)
      .filter((name) => name.startsWith("Copy of"));
    expect(copies).toEqual([
      `Copy of ${"A".repeat(52)}`,
      `Copy of ${"A".repeat(48)} (2)`,
    ]);
    expect(copies.every((name) => name.length <= 60)).toBe(true);
  });
});

describe("PDF documents: another workspace's document", () => {
  it("cannot be printed, edited, made default or deleted", async () => {
    await getPdfDocuments({ organizationId: "org-2" });
    const foreign = documentsOf("org-2")[0];

    await expect(
      resolvePdfDocumentForPrint({
        organizationId: ORG,
        requestedId: foreign.id,
      })
    ).rejects.toMatchObject({ status: 404 });
    for (const call of [
      () =>
        updatePdfDocument({
          organizationId: ORG,
          documentId: foreign.id,
          name: "Mine now",
          config: BOOKING_CHECKLIST_CONFIG,
        }),
      () =>
        setDefaultPdfDocument({ organizationId: ORG, documentId: foreign.id }),
      () => deletePdfDocument({ organizationId: ORG, documentId: foreign.id }),
      () =>
        duplicatePdfDocument({ organizationId: ORG, documentId: foreign.id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    expect(documentsOf("org-2")[0]).toMatchObject({
      name: "Checklist",
      isDefault: true,
    });
  });
});

describe("PDF documents: which document a print gets", () => {
  it("prints the remembered document, then the default when the remembered one is gone", async () => {
    await getPdfDocuments({ organizationId: ORG });
    const [, handover] = documentsOf();

    const remembered = await resolvePdfDocumentForPrint({
      organizationId: ORG,
      rememberedId: handover.id,
    });
    expect(remembered.document.name).toBe("Check-out receipt");

    const stale = await resolvePdfDocumentForPrint({
      organizationId: ORG,
      rememberedId: "deleted-document",
    });
    expect(stale.document.name).toBe("Checklist");
    expect(stale.documents.map((s) => s.name)).toEqual([
      "Checklist",
      "Check-out receipt",
    ]);
  });

  it("refuses a requested document that no longer exists", async () => {
    await expect(
      resolvePdfDocumentForPrint({
        organizationId: ORG,
        requestedId: "deleted-document",
      })
    ).rejects.toMatchObject({ status: 404, title: "Document not found" });
  });
});

describe("PDF documents: custom fields on a document", () => {
  beforeEach(() => {
    store.customFields = [
      { id: "cf-price", organizationId: ORG, type: "AMOUNT", deletedAt: null },
      { id: "cf-serial", organizationId: ORG, type: "TEXT", deletedAt: null },
      {
        id: "cf-notes",
        organizationId: ORG,
        type: "MULTILINE_TEXT",
        deletedAt: null,
      },
      { id: "cf-date", organizationId: ORG, type: "DATE", deletedAt: null },
      {
        id: "cf-old",
        organizationId: ORG,
        type: "TEXT",
        deletedAt: new Date(),
      },
      {
        id: "cf-foreign",
        organizationId: "org-2",
        type: "TEXT",
        deletedAt: null,
      },
    ];
  });

  async function save(customFieldIds: string[]) {
    await getPdfDocuments({ organizationId: ORG });
    return updatePdfDocument({
      organizationId: ORG,
      documentId: documentsOf()[0].id,
      name: "Client quote",
      config: { ...BOOKING_CHECKLIST_CONFIG, customFieldIds },
    });
  }

  it("saves up to three, in order", async () => {
    const saved = await save(["cf-price", "cf-serial", "cf-notes"]);

    expect(saved?.config.customFieldIds).toEqual([
      "cf-price",
      "cf-serial",
      "cf-notes",
    ]);
  });

  it("refuses a fourth", async () => {
    await expect(
      save(["cf-price", "cf-serial", "cf-notes", "cf-date"])
    ).rejects.toMatchObject({ status: 400, title: "Too many custom fields" });
    expect(documentsOf()[0].name).toBe("Checklist");
  });

  it("refuses another workspace's field and a deleted one", async () => {
    await expect(save(["cf-foreign"])).rejects.toMatchObject({ status: 400 });
    await expect(save(["cf-old"])).rejects.toMatchObject({
      status: 400,
      title: "Custom field deleted",
    });
  });
});

describe("PDF documents: which tiers include them", () => {
  it("follows the owner's tier when premium features are on", () => {
    expect(canCustomizePdfDocuments({ canCustomizePdfDocuments: true })).toBe(
      true
    );
    expect(canCustomizePdfDocuments({ canCustomizePdfDocuments: false })).toBe(
      false
    );
    expect(canCustomizePdfDocuments(null)).toBe(false);
  });

  it("includes them for every workspace when premium features are off", () => {
    premium.enabled = false;

    expect(canCustomizePdfDocuments({ canCustomizePdfDocuments: false })).toBe(
      true
    );
    expect(canCustomizePdfDocuments(null)).toBe(true);
  });
});
