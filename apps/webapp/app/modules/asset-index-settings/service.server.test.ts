import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";
import type { Column } from "./helpers";

// why: these tests exercise the settings logic, not Postgres; the db calls are
// stubbed so each test can hand in a saved row and read back what is persisted
vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn().mockResolvedValue(0),
    assetIndexSettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { db } = await import("~/database/db.server");
const { getAssetIndexSettings, removeCustomFieldFromAssetIndexSettings } =
  await import("./service.server");

const executeRawMock = vi.mocked(db.$executeRaw);
const findFirstMock = vi.mocked(db.assetIndexSettings.findFirst);
const updateMock = vi.mocked(db.assetIndexSettings.update);

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

describe("getAssetIndexSettings with a column set saved before the unit column", () => {
  /** The default columns as they were saved before `unitOfMeasure` existed. */
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

  /** Column names in display order. */
  const inOrder = (columns: Column[]) =>
    [...columns].sort((a, b) => a.position - b.position).map((col) => col.name);

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

  it("adds Unit of measure at position 18, hidden, right after Quantity", async () => {
    const saved = [...SAVED_DEFAULTS, ...SAVED_BARCODES, SAVED_CUSTOM_FIELD];

    const settings = await loadSavedColumns(saved, true);
    const columns = settings.columns as Column[];

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(columns.find((col) => col.name === "unitOfMeasure")).toEqual({
      name: "unitOfMeasure",
      visible: false,
      position: 18,
    });

    // Everything else keeps its order and its visibility.
    const savedOrder = inOrder(saved);
    const quantityIndex = savedOrder.indexOf("quantity");
    expect(inOrder(columns)).toEqual([
      ...savedOrder.slice(0, quantityIndex + 1),
      "unitOfMeasure",
      ...savedOrder.slice(quantityIndex + 1),
    ]);
    for (const col of saved) {
      expect(columns.find((c) => c.name === col.name)?.visible).toBe(
        col.visible
      );
    }

    // Positions stay unique, so the order is unambiguous.
    const positions = columns.map((col) => col.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("keeps a user's own column order around the new column", async () => {
    // The user swapped Min quantity (to the front) and ID (to the back).
    const reordered = SAVED_DEFAULTS.map((col) => {
      if (col.name === "minQuantity") return { ...col, position: 0 };
      if (col.name === "id") return { ...col, position: 20 };
      return col;
    });

    const settings = await loadSavedColumns(reordered, false);
    const columns = settings.columns as Column[];

    const savedOrder = inOrder(reordered);
    const newOrder = inOrder(columns);
    expect(newOrder.filter((name) => name !== "unitOfMeasure")).toEqual(
      savedOrder
    );
    expect(columns.find((col) => col.name === "unitOfMeasure")?.position).toBe(
      18
    );
  });

  it("leaves a column set that already has Unit of measure untouched", async () => {
    const saved: Column[] = [
      ...SAVED_DEFAULTS.map((col) =>
        col.position >= 18 ? { ...col, position: col.position + 1 } : col
      ),
      { name: "unitOfMeasure", visible: true, position: 18 },
    ];

    await loadSavedColumns(saved, false);

    expect(updateMock).not.toHaveBeenCalled();
  });
});
