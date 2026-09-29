import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";
import type { Column } from "./helpers";

// why: these tests exercise the settings logic, not Postgres; the db calls are
// stubbed so each test can hand in a saved row and read back what is persisted
vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
    asset: {
      findFirst: vi.fn(),
    },
    assetIndexSettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// why: creating a column set reads the workspace's custom fields; these tests
// are about the quantity columns, so the workspace has none
vi.mock("../organization/service.server", () => ({
  getOrganizationById: vi.fn().mockResolvedValue({ customFields: [] }),
}));

const { db } = await import("~/database/db.server");
const { getAssetIndexSettings, removeCustomFieldFromAssetIndexSettings } =
  await import("./service.server");

const executeRawMock = vi.mocked(db.$executeRaw);
const assetFindFirstMock = vi.mocked(db.asset.findFirst);
const findFirstMock = vi.mocked(db.assetIndexSettings.findFirst);
const updateMock = vi.mocked(db.assetIndexSettings.update);
const createMock = vi.mocked(db.assetIndexSettings.create);

describe("removeCustomFieldFromAssetIndexSettings", () => {
  beforeEach(() => {
    executeRawMock.mockClear();
  });

  it("removes the custom field column for all organization settings", async () => {
    await removeCustomFieldFromAssetIndexSettings({
      customFieldName: "Condition",
      organizationId: "org-123",
    });

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRawMock.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];

    expect(strings.join(" ")).toContain('UPDATE "AssetIndexSettings" AS ais');
    expect(values).toContain("cf_Condition");
    expect(values).toContain("org-123");
  });

  it("wraps database errors in a ShelfError", async () => {
    executeRawMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      removeCustomFieldFromAssetIndexSettings({
        customFieldName: "Condition",
        organizationId: "org-123",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});

describe("getAssetIndexSettings with a column set saved before the quantity columns", () => {
  /** The default columns as they were saved before the quantity columns. */
  const SAVED_DEFAULTS: Column[] = [
    { name: "id", visible: false, position: 0 },
    { name: "sequentialId", visible: true, position: 1 },
    { name: "qrId", visible: true, position: 2 },
    { name: "status", visible: true, position: 3 },
    { name: "description", visible: true, position: 4 },
    { name: "valuation", visible: true, position: 5 },
    { name: "availableToBook", visible: true, position: 6 },
    { name: "createdAt", visible: true, position: 7 },
    { name: "updatedAt", visible: true, position: 8 },
    { name: "category", visible: true, position: 9 },
    { name: "tags", visible: true, position: 10 },
    { name: "location", visible: true, position: 11 },
    { name: "kit", visible: true, position: 12 },
    { name: "custody", visible: true, position: 13 },
    { name: "upcomingReminder", visible: true, position: 14 },
    { name: "actions", visible: true, position: 15 },
    { name: "upcomingBookings", visible: true, position: 16 },
    // The user switched Quantity on.
    { name: "quantity", visible: true, position: 17 },
    { name: "type", visible: false, position: 18 },
    { name: "assetModel", visible: false, position: 19 },
    { name: "minQuantity", visible: false, position: 20 },
  ];
  const SAVED_BARCODES: Column[] = [
    { name: "barcode_Code128", visible: true, position: 21 },
    { name: "barcode_Code39", visible: true, position: 22 },
    { name: "barcode_DataMatrix", visible: true, position: 23 },
    { name: "barcode_ExternalQR", visible: true, position: 24 },
    { name: "barcode_EAN13", visible: true, position: 25 },
  ];
  const SAVED_CUSTOM_FIELD: Column = {
    name: "cf_Supplier",
    visible: true,
    position: 26,
    cfType: "TEXT",
  };

  const BLOCK = ["available", "quantity", "reserved", "stockStatus"];

  /** Column names in display order. */
  const inOrder = (columns: Column[]) =>
    [...columns].sort((a, b) => a.position - b.position).map((col) => col.name);

  const find = (columns: Column[], name: string) =>
    columns.find((col) => col.name === name);

  beforeEach(() => {
    findFirstMock.mockReset();
    updateMock.mockReset();
    updateMock.mockImplementation((({
      data,
    }: {
      data: { columns: Column[] };
    }) => Promise.resolve({ columns: data.columns })) as never);
  });

  function loadSavedColumns(columns: Column[], canUseBarcodes: boolean) {
    findFirstMock.mockResolvedValue({ columns } as never);
    return getAssetIndexSettings({
      userId: "user-1",
      organizationId: "org-1",
      canUseBarcodes,
    });
  }

  it("adds the quantity columns as one block around Total quantity, switched off", async () => {
    const saved = [...SAVED_DEFAULTS, ...SAVED_BARCODES, SAVED_CUSTOM_FIELD];

    const settings = await loadSavedColumns(saved, true);
    const columns = settings.columns as Column[];

    expect(updateMock).toHaveBeenCalledTimes(1);

    // One block where the user keeps Total quantity, everything else in order.
    const savedOrder = inOrder(saved);
    const quantityIndex = savedOrder.indexOf("quantity");
    expect(inOrder(columns)).toEqual([
      ...savedOrder.slice(0, quantityIndex),
      ...BLOCK,
      ...savedOrder.slice(quantityIndex + 1),
    ]);

    // Nothing new is switched on.
    expect(find(columns, "available")?.visible).toBe(false);
    expect(find(columns, "reserved")?.visible).toBe(false);
    expect(find(columns, "stockStatus")?.visible).toBe(false);

    // Every saved column keeps its visibility.
    for (const col of saved) {
      expect(find(columns, col.name)?.visible).toBe(col.visible);
    }

    // Positions stay unique, so the order is unambiguous.
    const positions = columns.map((col) => col.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("adds every new quantity column hidden when Total quantity is hidden too", async () => {
    const quantityHidden = SAVED_DEFAULTS.map((col) =>
      col.name === "quantity" ? { ...col, visible: false } : col
    );

    const settings = await loadSavedColumns(quantityHidden, false);
    const columns = settings.columns as Column[];

    for (const name of BLOCK) {
      expect(find(columns, name)?.visible).toBe(false);
    }
  });

  it("keeps the block next to Total quantity when the user moved it", async () => {
    // Quantity dragged to just after the Asset ID column.
    const quantityMoved = SAVED_DEFAULTS.map((col) => {
      if (col.name === "quantity") return { ...col, position: 2 };
      if (col.position >= 2 && col.position < 17) {
        return { ...col, position: col.position + 1 };
      }
      return col;
    });

    const settings = await loadSavedColumns(quantityMoved, false);
    const columns = settings.columns as Column[];

    const savedOrder = inOrder(quantityMoved);
    expect(inOrder(columns)).toEqual([
      ...savedOrder.slice(0, 2),
      ...BLOCK,
      ...savedOrder.slice(3),
    ]);
  });

  it("keeps a user's own column order around the new columns", async () => {
    // The user swapped Min quantity (to the front) and ID (to the back).
    const reordered = SAVED_DEFAULTS.map((col) => {
      if (col.name === "minQuantity") return { ...col, position: 0 };
      if (col.name === "id") return { ...col, position: 20 };
      return col;
    });

    const settings = await loadSavedColumns(reordered, false);
    const columns = settings.columns as Column[];

    const newOrder = inOrder(columns);
    expect(
      newOrder.filter((name) => !BLOCK.includes(name) || name === "quantity")
    ).toEqual(inOrder(reordered));
    const start = newOrder.indexOf("available");
    expect(newOrder.slice(start, start + BLOCK.length)).toEqual(BLOCK);
  });

  it("puts a missing column after the quantity columns the user already has", async () => {
    // Free now already shown, moved next to Status; Reserved and Stock status
    // missing.
    const saved: Column[] = [
      ...SAVED_DEFAULTS.map((col) =>
        col.position >= 4 ? { ...col, position: col.position + 1 } : col
      ),
      { name: "available", visible: true, position: 4 },
    ];

    const settings = await loadSavedColumns(saved, false);
    const columns = settings.columns as Column[];

    const newOrder = inOrder(columns);
    const quantityIndex = newOrder.indexOf("quantity");
    expect(newOrder.slice(quantityIndex, quantityIndex + 3)).toEqual([
      "quantity",
      "reserved",
      "stockStatus",
    ]);
    // The user's own Free now stays where and how they left it.
    expect(find(columns, "available")).toEqual({
      name: "available",
      visible: true,
      position: 4,
    });
    expect(find(columns, "stockStatus")?.visible).toBe(false);
  });

  it("leaves a column set that already has every quantity column untouched", async () => {
    const saved: Column[] = [
      ...SAVED_DEFAULTS.map((col) =>
        col.position >= 18 ? { ...col, position: col.position + 3 } : col
      ),
      { name: "available", visible: true, position: 18 },
      { name: "reserved", visible: false, position: 19 },
      { name: "stockStatus", visible: true, position: 20 },
    ];

    await loadSavedColumns(saved, false);

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("getAssetIndexSettings for a user with no saved column set", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    findFirstMock.mockResolvedValue(null);
    assetFindFirstMock.mockReset();
    createMock.mockReset();
    createMock.mockImplementation((({
      data,
    }: {
      data: { columns: Column[] };
    }) => Promise.resolve({ columns: data.columns })) as never);
  });

  async function createFor({
    hasQuantityAssets,
  }: {
    hasQuantityAssets: boolean;
  }) {
    assetFindFirstMock.mockResolvedValue(
      (hasQuantityAssets ? { id: "asset-1" } : null) as never
    );
    const settings = await getAssetIndexSettings({
      userId: "user-1",
      organizationId: "org-1",
    });
    return settings.columns as Column[];
  }

  const visibleAfterStatus = (columns: Column[]) =>
    [...columns]
      .filter((col) => col.visible)
      .sort((a, b) => a.position - b.position)
      .map((col) => col.name)
      .slice(2, 5);

  it("shows Free now and Stock status right after Status in a workspace with quantity-tracked assets", async () => {
    const columns = await createFor({ hasQuantityAssets: true });

    expect(visibleAfterStatus(columns)).toEqual([
      "status",
      "available",
      "stockStatus",
    ]);
    for (const name of ["quantity", "reserved"]) {
      expect(columns.find((col) => col.name === name)?.visible).toBe(false);
    }
  });

  it("starts every quantity column hidden in a workspace without quantity-tracked assets", async () => {
    const columns = await createFor({ hasQuantityAssets: false });

    for (const name of ["available", "quantity", "reserved", "stockStatus"]) {
      expect(columns.find((col) => col.name === name)?.visible).toBe(false);
    }
    expect(visibleAfterStatus(columns)[1]).toBe("description");
  });

  it("asks only whether the workspace has a quantity-tracked asset", async () => {
    await createFor({ hasQuantityAssets: true });

    expect(assetFindFirstMock).toHaveBeenCalledWith({
      where: { organizationId: "org-1", type: "QUANTITY_TRACKED" },
      select: { id: true },
    });
  });
});
