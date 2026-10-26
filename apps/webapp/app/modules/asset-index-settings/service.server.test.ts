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
const {
  getAssetIndexModeForUser,
  getAssetIndexSettings,
  removeCustomFieldFromAssetIndexSettings,
} = await import("./service.server");

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
  /**
   * The default columns as they were saved before the quantity columns, with
   * the Unit of measure and Last audit date columns that shipped before them.
   */
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
    // The user switched Quantity on, so its unit shows beside it.
    { name: "quantity", visible: true, position: 17 },
    { name: "unitOfMeasure", visible: true, position: 18 },
    { name: "type", visible: false, position: 19 },
    { name: "assetModel", visible: false, position: 20 },
    { name: "minQuantity", visible: false, position: 21 },
    { name: "lastAuditDate", visible: true, position: 22 },
  ];
  const SAVED_BARCODES: Column[] = [
    { name: "barcode_Code128", visible: true, position: 23 },
    { name: "barcode_Code39", visible: true, position: 24 },
    { name: "barcode_DataMatrix", visible: true, position: 25 },
    { name: "barcode_ExternalQR", visible: true, position: 26 },
    { name: "barcode_EAN13", visible: true, position: 27 },
  ];
  const SAVED_CUSTOM_FIELD: Column = {
    name: "cf_Supplier",
    visible: true,
    position: 28,
    cfType: "TEXT",
  };

  const BLOCK = [
    "available",
    "quantity",
    "unitOfMeasure",
    "reserved",
    "stockStatus",
  ];

  /** Column names in display order. */
  const inOrder = (columns: Column[]) =>
    [...columns].sort((a, b) => a.position - b.position).map((col) => col.name);

  const find = (columns: Column[], name: string) =>
    columns.find((col) => col.name === name);

  beforeEach(() => {
    findFirstMock.mockReset();
    assetFindFirstMock.mockReset();
    updateMock.mockReset();
    updateMock.mockImplementation((({
      data,
    }: {
      data: { columns: Column[] };
    }) => Promise.resolve({ columns: data.columns })) as never);
  });

  /** Loads a saved set; the workspace tracks quantities unless told otherwise. */
  function loadSavedColumns(
    columns: Column[],
    canUseBarcodes: boolean,
    { hasQuantityAssets = true }: { hasQuantityAssets?: boolean } = {}
  ) {
    findFirstMock.mockResolvedValue({ columns } as never);
    assetFindFirstMock.mockResolvedValue(
      (hasQuantityAssets ? { id: "asset-1" } : null) as never
    );
    return getAssetIndexSettings({
      userId: "user-1",
      organizationId: "org-1",
      canUseBarcodes,
    });
  }

  it("keeps the block next to Total quantity when the user shows it, Free now and Stock status on", async () => {
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
      ...savedOrder.slice(quantityIndex + 2),
    ]);

    // The workspace tracks quantities: the two new default columns appear,
    // Reserved stays one switch away.
    expect(find(columns, "available")?.visible).toBe(true);
    expect(find(columns, "stockStatus")?.visible).toBe(true);
    expect(find(columns, "reserved")?.visible).toBe(false);

    // Every saved column keeps its visibility.
    for (const col of saved) {
      expect(find(columns, col.name)?.visible).toBe(col.visible);
    }

    // Positions stay unique, so the order is unambiguous.
    const positions = columns.map((col) => col.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  /**
   * The saved defaults with Total quantity hidden, as most saved sets have it,
   * and its unit hidden with it.
   */
  const QUANTITY_HIDDEN = SAVED_DEFAULTS.map((col) =>
    col.name === "quantity" || col.name === "unitOfMeasure"
      ? { ...col, visible: false }
      : col
  );

  /** The quantity block as a fresh set has it, Min quantity included. */
  const FULL_BLOCK = [...BLOCK, "minQuantity"];

  it("puts the block right after Status when Total quantity is hidden, Free now and Stock status on", async () => {
    const saved = [...QUANTITY_HIDDEN, ...SAVED_BARCODES, SAVED_CUSTOM_FIELD];

    const settings = await loadSavedColumns(saved, true);
    const columns = settings.columns as Column[];

    // Right after Status, so the new columns open on the first screen. The
    // hidden Total quantity and Min quantity moved in with them; everything
    // else keeps its order.
    const others = inOrder(saved).filter((name) => !FULL_BLOCK.includes(name));
    const statusIndex = others.indexOf("status");
    expect(inOrder(columns)).toEqual([
      ...others.slice(0, statusIndex + 1),
      ...FULL_BLOCK,
      ...others.slice(statusIndex + 1),
    ]);

    expect(find(columns, "available")?.visible).toBe(true);
    expect(find(columns, "stockStatus")?.visible).toBe(true);
    // Total quantity, Reserved and Min quantity stay as the user had them.
    expect(find(columns, "quantity")?.visible).toBe(false);
    expect(find(columns, "reserved")?.visible).toBe(false);
    expect(find(columns, "minQuantity")?.visible).toBe(false);
    for (const col of saved) {
      expect(find(columns, col.name)?.visible).toBe(col.visible);
    }

    const positions = columns.map((col) => col.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("leaves a Min quantity the user shows where it is", async () => {
    const minQuantityShown = QUANTITY_HIDDEN.map((col) =>
      col.name === "minQuantity" ? { ...col, visible: true } : col
    );

    const settings = await loadSavedColumns(minQuantityShown, false);
    const columns = settings.columns as Column[];

    const newOrder = inOrder(columns);
    const statusIndex = newOrder.indexOf("status");
    expect(
      newOrder.slice(statusIndex + 1, statusIndex + 1 + BLOCK.length)
    ).toEqual(BLOCK);
    // Still after the same columns it followed before.
    const savedOrder = inOrder(minQuantityShown);
    expect(newOrder[newOrder.indexOf("minQuantity") - 1]).toBe(
      savedOrder[savedOrder.indexOf("minQuantity") - 1]
    );
    expect(find(columns, "minQuantity")?.visible).toBe(true);
  });

  it("gathers the block after Status, switched off, in a workspace without quantity-tracked assets", async () => {
    const settings = await loadSavedColumns(QUANTITY_HIDDEN, false, {
      hasQuantityAssets: false,
    });
    const columns = settings.columns as Column[];

    const newOrder = inOrder(columns);
    const statusIndex = newOrder.indexOf("status");
    expect(
      newOrder.slice(statusIndex + 1, statusIndex + 1 + FULL_BLOCK.length)
    ).toEqual(FULL_BLOCK);
    for (const name of FULL_BLOCK) {
      expect(find(columns, name)?.visible).toBe(false);
    }
  });

  it("adds every new quantity column switched off next to a shown Total quantity in a workspace without quantity-tracked assets", async () => {
    const saved = [...SAVED_DEFAULTS, ...SAVED_BARCODES, SAVED_CUSTOM_FIELD];

    const settings = await loadSavedColumns(saved, true, {
      hasQuantityAssets: false,
    });
    const columns = settings.columns as Column[];

    for (const name of ["available", "reserved", "stockStatus"]) {
      expect(find(columns, name)?.visible).toBe(false);
    }
    // Still one block, ready for the day the workspace starts counting.
    const newOrder = inOrder(columns);
    const start = newOrder.indexOf("available");
    expect(newOrder.slice(start, start + BLOCK.length)).toEqual(BLOCK);
    for (const col of saved) {
      expect(find(columns, col.name)?.visible).toBe(col.visible);
    }
  });

  it("keeps the block next to Total quantity when the user moved it", async () => {
    // Quantity and its unit dragged to just after the Asset ID column.
    const quantityMoved = SAVED_DEFAULTS.map((col) => {
      if (col.name === "quantity") return { ...col, position: 2 };
      if (col.name === "unitOfMeasure") return { ...col, position: 3 };
      if (col.position >= 2 && col.position < 17) {
        return { ...col, position: col.position + 2 };
      }
      return col;
    });

    const settings = await loadSavedColumns(quantityMoved, false);
    const columns = settings.columns as Column[];

    const savedOrder = inOrder(quantityMoved);
    expect(inOrder(columns)).toEqual([
      ...savedOrder.slice(0, 2),
      ...BLOCK,
      ...savedOrder.slice(4),
    ]);
  });

  it("keeps a user's own column order around the new columns", async () => {
    // The user swapped Min quantity (to the front) and ID (to the back).
    const reordered = SAVED_DEFAULTS.map((col) => {
      if (col.name === "minQuantity") return { ...col, position: 0 };
      if (col.name === "id") return { ...col, position: 21 };
      return col;
    });

    const settings = await loadSavedColumns(reordered, false);
    const columns = settings.columns as Column[];

    const newOrder = inOrder(columns);
    expect(
      newOrder.filter(
        (name) =>
          !BLOCK.includes(name) ||
          name === "quantity" ||
          name === "unitOfMeasure"
      )
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
    expect(newOrder.slice(quantityIndex, quantityIndex + 4)).toEqual([
      "quantity",
      "unitOfMeasure",
      "reserved",
      "stockStatus",
    ]);
    // The user's own Free now stays where and how they left it.
    expect(find(columns, "available")).toEqual({
      name: "available",
      visible: true,
      position: 4,
    });
    expect(find(columns, "stockStatus")?.visible).toBe(true);
    expect(find(columns, "reserved")?.visible).toBe(false);
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
    // Nothing missing, so the workspace is not asked about its assets.
    expect(assetFindFirstMock).not.toHaveBeenCalled();
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

describe("getAssetIndexSettings with a column set saved before the unit column", () => {
  /**
   * The default columns as they were saved before `unitOfMeasure` existed, so
   * the stock columns are missing too and arrive with it as one block.
   */
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
    { name: "lastAuditDate", visible: true, position: 21 },
  ];
  const SAVED_BARCODES: Column[] = [
    { name: "barcode_Code128", visible: true, position: 22 },
    { name: "barcode_Code39", visible: true, position: 23 },
    { name: "barcode_DataMatrix", visible: true, position: 24 },
    { name: "barcode_ExternalQR", visible: true, position: 25 },
    { name: "barcode_EAN13", visible: true, position: 26 },
  ];
  const SAVED_CUSTOM_FIELD: Column = {
    name: "cf_Supplier",
    visible: true,
    position: 27,
    cfType: "TEXT",
  };

  /** Column names in display order. */
  const inOrder = (columns: Column[]) =>
    [...columns].sort((a, b) => a.position - b.position).map((col) => col.name);

  beforeEach(() => {
    findFirstMock.mockReset();
    assetFindFirstMock.mockReset();
    assetFindFirstMock.mockResolvedValue({ id: "asset-1" } as never);
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

  /** The name right after `name` in display order. */
  const nextAfter = (columns: Column[], name: Column["name"]) => {
    const order = inOrder(columns);
    return order[order.indexOf(name) + 1];
  };
  const unitOf = (columns: Column[]) =>
    columns.find((col) => col.name === "unitOfMeasure");

  it("adds Unit of measure right after Quantity, shown because Quantity is shown", async () => {
    const saved = [...SAVED_DEFAULTS, ...SAVED_BARCODES, SAVED_CUSTOM_FIELD];

    const settings = await loadSavedColumns(saved, true);
    const columns = settings.columns as Column[];

    expect(updateMock).toHaveBeenCalledTimes(1);
    // The Quantity cell holds only the number, so a user who sees Quantity
    // keeps seeing the unit.
    expect(nextAfter(columns, "quantity")).toBe("unitOfMeasure");
    expect(unitOf(columns)?.visible).toBe(true);

    // Every saved column keeps its order and its visibility.
    const savedOrder = inOrder(saved);
    expect(
      inOrder(columns).filter((name) => savedOrder.includes(name))
    ).toEqual(savedOrder);
    for (const col of saved) {
      expect(columns.find((c) => c.name === col.name)?.visible).toBe(
        col.visible
      );
    }

    // Positions stay unique, so the order is unambiguous.
    const positions = columns.map((col) => col.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("adds Unit of measure hidden when Quantity is hidden", async () => {
    const quantityHidden = SAVED_DEFAULTS.map((col) =>
      col.name === "quantity" ? { ...col, visible: false } : col
    );

    const settings = await loadSavedColumns(quantityHidden, false);
    const columns = settings.columns as Column[];

    expect(nextAfter(columns, "quantity")).toBe("unitOfMeasure");
    expect(unitOf(columns)?.visible).toBe(false);
  });

  it("puts Unit of measure right after Quantity when the user moved Quantity", async () => {
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
    expect(
      inOrder(columns).filter((name) => savedOrder.includes(name))
    ).toEqual(savedOrder);
    expect(nextAfter(columns, "quantity")).toBe("unitOfMeasure");
    expect(unitOf(columns)?.visible).toBe(true);
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
    expect(newOrder.filter((name) => savedOrder.includes(name))).toEqual(
      savedOrder
    );
    expect(nextAfter(columns, "quantity")).toBe("unitOfMeasure");
  });

  it("leaves a column set that already has Unit of measure untouched", async () => {
    const saved: Column[] = [
      ...SAVED_DEFAULTS.map((col) =>
        col.position >= 18 ? { ...col, position: col.position + 4 } : col
      ),
      { name: "unitOfMeasure", visible: true, position: 18 },
      { name: "available", visible: true, position: 19 },
      { name: "reserved", visible: false, position: 20 },
      { name: "stockStatus", visible: true, position: 21 },
    ];

    await loadSavedColumns(saved, false);

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("getAssetIndexModeForUser", () => {
  const args = { userId: "user-1", organizationId: "org-1" };

  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockClear();
  });

  it("returns the saved mode", async () => {
    findFirstMock.mockResolvedValue({ mode: "ADVANCED" } as never);

    await expect(
      getAssetIndexModeForUser({
        ...args,
        ui: { advancedAssetIndex: true, defaultAssetIndexMode: "SIMPLE" },
      })
    ).resolves.toBe("ADVANCED");
  });

  it("falls back to the role default without creating a settings row", async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(
      getAssetIndexModeForUser({
        ...args,
        ui: { advancedAssetIndex: true, defaultAssetIndexMode: "ADVANCED" },
      })
    ).resolves.toBe("ADVANCED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("reports SIMPLE when the role cannot use the advanced index", async () => {
    findFirstMock.mockResolvedValue({ mode: "ADVANCED" } as never);

    await expect(
      getAssetIndexModeForUser({
        ...args,
        ui: { advancedAssetIndex: false, defaultAssetIndexMode: "SIMPLE" },
      })
    ).resolves.toBe("SIMPLE");
  });

  it("wraps database errors in a ShelfError", async () => {
    findFirstMock.mockRejectedValue(new Error("boom"));

    await expect(
      getAssetIndexModeForUser({
        ...args,
        ui: { advancedAssetIndex: true, defaultAssetIndexMode: "SIMPLE" },
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});
