// @vitest-environment node
/* eslint-disable @typescript-eslint/require-await -- why: the in-memory table
   answers with promises, as Prisma does, without awaiting anything itself */
/**
 * A workspace's PDF templates: what a workspace starts with, the one-default
 * and keep-one rules, which template a print gets, and which custom fields a
 * template may name.
 *
 * Runs against an in-memory `pdfTemplate` table that honours the same
 * workspace scoping and unique names as the real one, so the tests read what
 * the service leaves behind rather than which calls it made.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOKING_CHECKLIST_CONFIG, CHECKOUT_RECEIPT_CONFIG } from "./config";
import {
  createPdfTemplate,
  deletePdfTemplate,
  duplicatePdfTemplate,
  getPdfTemplates,
  resolvePdfTemplateForPrint,
  setDefaultPdfTemplate,
  updatePdfTemplate,
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

const pdfTemplate = vi.hoisted(() => ({
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
          id: `template-${++store.seq}`,
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
          await pdfTemplate.create({ data: item });
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

/** Every raw query the service ran, as its SQL text and its values. */
const rawQueries = vi.hoisted(() => [] as { sql: string; values: unknown[] }[]);
const queryRaw = vi.hoisted(
  () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      rawQueries.push({ sql: strings.join("?"), values });
      return [];
    }
);

// why: the service's rules are about what the table holds; an in-memory table
// with the real scoping and unique indexes keeps the tests off a database.
vi.mock("~/database/db.server", () => {
  const db = {
    pdfTemplate,
    customField,
    // why: the row lock has no effect on a single-threaded in-memory table;
    // the SQL it was given is kept so a test can read it.
    $queryRaw: queryRaw,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db };
});

const ORG = "org-1";

beforeEach(() => {
  store.rows = [];
  store.customFields = [];
  store.seq = 0;
  rawQueries.length = 0;
});

function templatesOf(organizationId = ORG) {
  return sorted(store.rows.filter((r) => r.organizationId === organizationId));
}

describe("PDF templates: what a workspace starts with", () => {
  it("gives a workspace with no templates the Checklist (default) and Check-out receipt", async () => {
    const templates = await getPdfTemplates({ organizationId: ORG });

    expect(
      templates.map(({ name, isDefault }) => ({ name, isDefault }))
    ).toEqual([
      { name: "Checklist", isDefault: true },
      { name: "Check-out receipt", isDefault: false },
    ]);
    expect(templates[0].config).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(templates[1].config).toEqual(CHECKOUT_RECEIPT_CONFIG);
  });

  it("gives a workspace with no templates both built-ins on first read", async () => {
    const first = await getPdfTemplates({ organizationId: ORG });
    expect(first.map((t) => t.name)).toEqual([
      "Checklist",
      "Check-out receipt",
    ]);
    expect(first[0].isDefault).toBe(true);

    await getPdfTemplates({ organizationId: ORG });
    expect(templatesOf()).toHaveLength(2);
  });

  it("does not add the built-in templates again to a workspace that has templates", async () => {
    await getPdfTemplates({ organizationId: ORG });
    await getPdfTemplates({ organizationId: ORG });

    expect(templatesOf()).toHaveLength(2);
  });
});

describe("PDF templates: the default and the last template", () => {
  it("locks the workspace's templates, by table and column name, before deleting", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const [, receipt] = templatesOf();

    await deletePdfTemplate({ organizationId: ORG, templateId: receipt.id });

    expect(rawQueries).toEqual([
      {
        sql: 'SELECT "id" FROM "PdfTemplate" WHERE "organizationId" = ? FOR UPDATE',
        values: [ORG],
      },
    ]);
  });

  it("refuses to delete the last template", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const [checklist, handover] = templatesOf();
    await deletePdfTemplate({ organizationId: ORG, templateId: handover.id });

    await expect(
      deletePdfTemplate({ organizationId: ORG, templateId: checklist.id })
    ).rejects.toMatchObject({ status: 400, title: "Keep one template" });
    expect(templatesOf().map((s) => s.name)).toEqual(["Checklist"]);
  });

  it("makes the oldest remaining template the default when the default is deleted", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const [checklist] = templatesOf();
    await createPdfTemplate({ organizationId: ORG, name: "Client quote" });

    await deletePdfTemplate({ organizationId: ORG, templateId: checklist.id });

    expect(
      templatesOf().map(({ name, isDefault }) => ({ name, isDefault }))
    ).toEqual([
      { name: "Check-out receipt", isDefault: true },
      { name: "Client quote", isDefault: false },
    ]);
  });

  it("moves the default, keeping exactly one", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const handover = templatesOf()[1];

    await setDefaultPdfTemplate({
      organizationId: ORG,
      templateId: handover.id,
    });

    expect(
      templatesOf()
        .filter((s) => s.isDefault)
        .map((s) => s.name)
    ).toEqual(["Check-out receipt"]);
  });

  it("names a copy after its source, never the default", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const checklist = templatesOf()[0];

    await duplicatePdfTemplate({
      organizationId: ORG,
      templateId: checklist.id,
    });
    await duplicatePdfTemplate({
      organizationId: ORG,
      templateId: checklist.id,
    });

    const copies = templatesOf().filter((s) => s.name.startsWith("Copy of"));
    expect(copies.map((s) => [s.name, s.isDefault])).toEqual([
      ["Copy of Checklist", false],
      ["Copy of Checklist (2)", false],
    ]);
  });

  it("refuses a name another template of the workspace has, whatever its case", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const handover = templatesOf()[1];

    await expect(
      createPdfTemplate({ organizationId: ORG, name: "checklist" })
    ).rejects.toMatchObject({ status: 400, title: "Name already used" });
    await expect(
      updatePdfTemplate({
        organizationId: ORG,
        templateId: handover.id,
        name: "CHECKLIST",
        config: CHECKOUT_RECEIPT_CONFIG,
      })
    ).rejects.toMatchObject({ status: 400, title: "Name already used" });
    expect(templatesOf().map((s) => s.name)).toEqual([
      "Checklist",
      "Check-out receipt",
    ]);
  });

  it("keeps a copy's name within the name limit", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const long = await createPdfTemplate({
      organizationId: ORG,
      name: "A".repeat(60),
    });

    await duplicatePdfTemplate({ organizationId: ORG, templateId: long!.id });
    await duplicatePdfTemplate({ organizationId: ORG, templateId: long!.id });

    const copies = templatesOf()
      .map((s) => s.name)
      .filter((name) => name.startsWith("Copy of"));
    expect(copies).toEqual([
      `Copy of ${"A".repeat(52)}`,
      `Copy of ${"A".repeat(48)} (2)`,
    ]);
    expect(copies.every((name) => name.length <= 60)).toBe(true);
  });
});

describe("PDF templates: another workspace's template", () => {
  it("cannot be printed, edited, made default or deleted", async () => {
    await getPdfTemplates({ organizationId: "org-2" });
    const foreign = templatesOf("org-2")[0];

    await expect(
      resolvePdfTemplateForPrint({
        organizationId: ORG,
        requestedId: foreign.id,
      })
    ).rejects.toMatchObject({ status: 404 });
    for (const call of [
      () =>
        updatePdfTemplate({
          organizationId: ORG,
          templateId: foreign.id,
          name: "Mine now",
          config: BOOKING_CHECKLIST_CONFIG,
        }),
      () =>
        setDefaultPdfTemplate({ organizationId: ORG, templateId: foreign.id }),
      () => deletePdfTemplate({ organizationId: ORG, templateId: foreign.id }),
      () =>
        duplicatePdfTemplate({ organizationId: ORG, templateId: foreign.id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 404 });
    }
    expect(templatesOf("org-2")[0]).toMatchObject({
      name: "Checklist",
      isDefault: true,
    });
  });
});

describe("PDF templates: which template a print gets", () => {
  it("prints the remembered template, then the default when the remembered one is gone", async () => {
    await getPdfTemplates({ organizationId: ORG });
    const [, handover] = templatesOf();

    const remembered = await resolvePdfTemplateForPrint({
      organizationId: ORG,
      rememberedId: handover.id,
    });
    expect(remembered.template.name).toBe("Check-out receipt");

    const stale = await resolvePdfTemplateForPrint({
      organizationId: ORG,
      rememberedId: "deleted-template",
    });
    expect(stale.template.name).toBe("Checklist");
    expect(stale.templates.map((s) => s.name)).toEqual([
      "Checklist",
      "Check-out receipt",
    ]);
  });

  it("prints with the oldest template when none is marked default", async () => {
    for (const [id, name, ms] of [
      ["newer", "Newer", 2000],
      ["older", "Older", 1000],
    ] as const) {
      store.rows.push({
        id,
        organizationId: ORG,
        name,
        kind: "BOOKING",
        config: BOOKING_CHECKLIST_CONFIG,
        isDefault: false,
        createdAt: new Date(ms),
      });
    }

    const { template } = await resolvePdfTemplateForPrint({
      organizationId: ORG,
    });

    expect(template.id).toBe("older");
  });

  it("falls back to the default when the remembered template is gone or foreign", async () => {
    await getPdfTemplates({ organizationId: ORG });
    await getPdfTemplates({ organizationId: "org-2" });
    const foreign = templatesOf("org-2")[1];

    for (const rememberedId of ["deleted-template", foreign.id]) {
      const { template } = await resolvePdfTemplateForPrint({
        organizationId: ORG,
        rememberedId,
      });
      expect(template.name).toBe("Checklist");
      expect(template.isDefault).toBe(true);
    }
  });

  it("refuses a requested template that no longer exists", async () => {
    await expect(
      resolvePdfTemplateForPrint({
        organizationId: ORG,
        requestedId: "deleted-template",
      })
    ).rejects.toMatchObject({ status: 404, title: "Template not found" });
  });
});

describe("PDF templates: custom fields on a template", () => {
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
    await getPdfTemplates({ organizationId: ORG });
    return updatePdfTemplate({
      organizationId: ORG,
      templateId: templatesOf()[0].id,
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
    expect(templatesOf()[0].name).toBe("Checklist");
  });

  it("refuses another workspace's field and a deleted one", async () => {
    await expect(save(["cf-foreign"])).rejects.toMatchObject({ status: 400 });
    await expect(save(["cf-old"])).rejects.toMatchObject({
      status: 400,
      title: "Custom field deleted",
    });
  });
});
