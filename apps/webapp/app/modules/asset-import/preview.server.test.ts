// @vitest-environment node
/**
 * Tests for the import preview builder: what the draft stores, what the
 * preview returns and how cells are marked.
 *
 * @see {@link file://./preview.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { findMissingImportEntities } from "./missing-entities.server";
import { buildContentImportPreview, toImportGridRows } from "./preview.server";
import type { ImportNewEntities } from "./types";
import { validateContentImportFile } from "./validate.server";

// why: the draft is written to the database; `$transaction` runs its callback
// against the same mock so the calls inside it can be asserted.
vi.mock("~/database/db.server", () => {
  const assetImport = { create: vi.fn(), deleteMany: vi.fn() };
  const dbMock = {
    assetImport,
    $transaction: vi.fn(),
  };
  dbMock.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(dbMock)
  );
  return { db: dbMock };
});

// why: validation has its own tests; this file tests what the preview stores.
vi.mock("./validate.server", () => ({ validateContentImportFile: vi.fn() }));

// why: the lookup reads the database and has its own tests.
vi.mock("./missing-entities.server", () => ({
  findMissingImportEntities: vi.fn(),
}));

const emptyEntities: ImportNewEntities = {
  categories: [],
  locations: [],
  tags: [],
  kits: [],
  custodians: [],
  customFields: [],
  assetModels: [],
};

const args = {
  fileName: null,
  organizationId: "org",
  userId: "u",
  canUseBarcodes: false,
};

describe("buildContentImportPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateContentImportFile).mockResolvedValue(undefined);
    vi.mocked(findMissingImportEntities).mockResolvedValue(emptyEntities);
    vi.mocked(db.assetImport.create).mockResolvedValue({ id: "imp" } as never);
    vi.mocked(db.$transaction).mockImplementation(((
      cb: (tx: unknown) => unknown
    ) => cb(db)) as never);
  });

  it("allocates a stable asset id and spreadsheet row number per row", async () => {
    const preview = await buildContentImportPreview({
      ...args,
      csvData: [
        ["title", "category"],
        ["Drill", "Tools"],
        ["Saw", "Tools"],
      ],
      fileName: "tools.csv",
    });

    const stored = vi.mocked(db.assetImport.create).mock.calls[0][0].data
      .rows as unknown as Array<{
      title: string;
      rowNumber: number;
      assetId: string;
    }>;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ title: "Drill", rowNumber: 2 });
    expect(stored[1]).toMatchObject({ title: "Saw", rowNumber: 3 });
    expect(stored[0].assetId).toHaveLength(25);
    expect(stored[0].assetId).not.toBe(stored[1].assetId);
    expect(preview.totalRows).toBe(2);
    expect(preview.importId).toBe("imp");
  });

  it("deletes the user's older drafts in this workspace before writing the new one", async () => {
    await buildContentImportPreview({ ...args, csvData: [["title"], ["A"]] });

    expect(db.assetImport.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org", createdById: "u", status: "DRAFT" },
    });
  });

  it("writes nothing when validation fails", async () => {
    vi.mocked(validateContentImportFile).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "bad",
        label: "Assets",
        status: 400,
      })
    );

    await expect(
      buildContentImportPreview({ ...args, csvData: [["title"], [""]] })
    ).rejects.toThrow("bad");
    expect(db.assetImport.create).not.toHaveBeenCalled();
  });

  it("counts rows with an image, a custodian, a kit or tracked quantity", async () => {
    const preview = await buildContentImportPreview({
      ...args,
      csvData: [
        ["title", "imageUrl", "custodian", "kit", "type"],
        ["A", "https://x.test/a.png", "Sam", "", ""],
        ["B", "", "", "Kit 1", "QUANTITY_TRACKED"],
      ],
    });

    expect(preview.counts).toEqual({
      withImage: 1,
      withCustodian: 1,
      inKit: 1,
      quantityTracked: 1,
    });
  });

  describe("External QR value warnings", () => {
    it("warns about bare web addresses with the spreadsheet row and still stores the draft", async () => {
      const preview = await buildContentImportPreview({
        ...args,
        csvData: [
          ["title", "barcode_ExternalQR"],
          ["Drill", "example.com/abc"],
          ["Saw", "https://ok.example.com/x"],
          ["Ladder", "https://ok.example.com/y,shop.example.co.uk/item"],
        ],
      });

      expect(preview.totalValueWarnings).toBe(2);
      expect(preview.valueWarnings.map((warning) => warning.row)).toEqual([
        2, 4,
      ]);
      expect(preview.valueWarnings[0].message).toContain('"example.com/abc"');
      expect(preview.valueWarnings[1].message).toContain(
        '"shop.example.co.uk/item"'
      );
      expect(preview.rows[0].cells.barcode_ExternalQR.tone).toBe("warning");
      expect(preview.rows[0].cells.barcode_ExternalQR.note).toContain(
        "without"
      );
      expect(preview.rows[1].cells.barcode_ExternalQR.tone).toBe("plain");
      expect(preview.rows[2].cells.barcode_ExternalQR.tone).toBe("warning");
      expect(db.assetImport.create).toHaveBeenCalledTimes(1);
    });

    it("returns no warnings when every value has a protocol", async () => {
      const preview = await buildContentImportPreview({
        ...args,
        csvData: [
          ["title", "barcode_ExternalQR"],
          ["Drill", "https://example.com/abc"],
          ["Saw", ""],
        ],
      });

      expect(preview.valueWarnings).toEqual([]);
      expect(preview.totalValueWarnings).toBe(0);
    });
  });
});

describe("toImportGridRows", () => {
  it("marks names the import will create and caps the row count", () => {
    const rows = [
      {
        key: "1",
        title: "Drill",
        category: "Tools",
        assetId: "a1",
        rowNumber: 2,
      },
      { key: "2", title: "Saw", category: "Old", assetId: "a2", rowNumber: 3 },
    ] as never;

    const grid = toImportGridRows(
      rows,
      ["title", "category"],
      { ...emptyEntities, categories: ["Tools"] },
      1
    );

    expect(grid).toHaveLength(1);
    expect(grid[0].label).toBe("2");
    expect(grid[0].cells.category).toEqual({
      value: "Tools",
      tone: "new",
      note: "Will be created",
    });
    expect(grid[0].cells.title).toEqual({ value: "Drill", tone: "plain" });
  });

  it("renders tags as a joined list and marks it when any tag is new", () => {
    const rows = [
      {
        key: "1",
        title: "Drill",
        tags: ["Old", "Fresh"],
        assetId: "a",
        rowNumber: 2,
      },
    ] as never;

    const grid = toImportGridRows(
      rows,
      ["tags"],
      { ...emptyEntities, tags: ["Fresh"] },
      10
    );

    expect(grid[0].cells.tags).toEqual({
      value: "Old, Fresh",
      tone: "new",
      note: "Will be created",
    });
  });
});
