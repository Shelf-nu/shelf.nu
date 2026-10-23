import { describe, expect, it } from "vitest";

import type { Column } from "./helpers";
import {
  insertMissingDefaultColumns,
  columnsLabelsMap,
  defaultFields,
  fixedFields,
  QUANTITY_COLUMN_BLOCK,
} from "./helpers";

describe("asset index column metadata", () => {
  it("registers last updated as a fixed field with a label", () => {
    expect(fixedFields).toContain("updatedAt");
    expect(columnsLabelsMap.updatedAt).toBe("Updated at");
  });

  it("enables the last updated column by default after the created column", () => {
    const createdColumn = defaultFields.find(
      (column) => column.name === "createdAt"
    );
    const updatedColumn = defaultFields.find(
      (column) => column.name === "updatedAt"
    );

    expect(createdColumn?.visible).toBe(true);
    expect(updatedColumn).toEqual(expect.objectContaining({ visible: true }));
    expect(updatedColumn && createdColumn).toBeTruthy();
    expect(updatedColumn?.position).toBe((createdColumn?.position ?? -1) + 1);

    const positions = defaultFields.map((column) => column.position);
    const expectedPositions = positions.map((_, index) => index);
    expect(positions).toEqual(expectedPositions);
  });

  it("registers unit of measure as a hidden-by-default column right after quantity", () => {
    expect(fixedFields).toContain("unitOfMeasure");
    expect(columnsLabelsMap.unitOfMeasure).toBe("Unit of measure");

    const quantityColumn = defaultFields.find(
      (column) => column.name === "quantity"
    );
    const unitColumn = defaultFields.find(
      (column) => column.name === "unitOfMeasure"
    );
    expect(unitColumn).toEqual({
      name: "unitOfMeasure",
      visible: false,
      position: (quantityColumn?.position ?? -1) + 1,
    });
  });

  it("registers min quantity as a fixed, hidden-by-default field with a label", () => {
    expect(fixedFields).toContain("minQuantity");
    expect(columnsLabelsMap.minQuantity).toBe("Min quantity");

    const minQuantityColumn = defaultFields.find(
      (column) => column.name === "minQuantity"
    );
    expect(minQuantityColumn).toEqual(
      expect.objectContaining({ visible: false })
    );
  });

  it("keeps the quantity columns together right after Status, with Min quantity beside Stock status", () => {
    const order = [...defaultFields]
      .sort((a, b) => a.position - b.position)
      .map((column) => column.name);
    const start = order.indexOf("status") + 1;

    expect(order.slice(start, start + QUANTITY_COLUMN_BLOCK.length)).toEqual([
      ...QUANTITY_COLUMN_BLOCK,
    ]);
    expect(order[order.indexOf("stockStatus") + 1]).toBe("minQuantity");
  });

  it("starts only Free now and Stock status visible in the quantity block", () => {
    const visible = defaultFields
      .filter((column) => QUANTITY_COLUMN_BLOCK.includes(column.name))
      .filter((column) => column.visible)
      .map((column) => column.name);

    expect(visible).toEqual(["available", "stockStatus"]);
  });
});

describe("insertMissingDefaultColumns", () => {
  it("adds a missing default column after the saved columns, never on a taken position", () => {
    const lastAuditDefault = defaultFields.find(
      (column) => column.name === "lastAuditDate"
    );
    // A saved list where another column already sits at the new column's
    // default position.
    const saved: Column[] = [
      { name: "name", visible: true, position: 0 },
      {
        name: "barcode_Code128",
        visible: true,
        position: lastAuditDefault?.position ?? 21,
      },
      { name: "cf_Serial", visible: true, position: 30 },
    ] as Column[];

    const result = insertMissingDefaultColumns(saved, ["lastAuditDate"], {
      hasQuantityAssets: true,
    });

    expect(result.slice(0, 3)).toEqual(saved);
    expect(result[3]).toEqual(
      expect.objectContaining({
        name: "lastAuditDate",
        visible: true,
        position: 31,
      })
    );
    const positions = result.map((column) => column.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("returns the saved columns untouched when nothing is missing", () => {
    const saved = [{ name: "name", visible: true, position: 0 }] as Column[];

    expect(
      insertMissingDefaultColumns(saved, [], { hasQuantityAssets: true })
    ).toBe(saved);
  });

  it("adds Unit of measure after the saved columns, hidden, when the set has no Quantity", () => {
    const saved = [
      { name: "name", visible: true, position: 0 },
      { name: "cf_Serial", visible: true, position: 7 },
    ] as Column[];

    const result = insertMissingDefaultColumns(saved, ["unitOfMeasure"], {
      hasQuantityAssets: true,
    });

    expect(result.slice(0, 2)).toEqual(saved);
    expect(result[2]).toEqual({
      name: "unitOfMeasure",
      visible: false,
      position: 8,
    });
  });

  it("puts Unit of measure right after Quantity when both are missing", () => {
    const saved = [
      { name: "name", visible: true, position: 0 },
      { name: "cf_Serial", visible: true, position: 4 },
    ] as Column[];

    const result = insertMissingDefaultColumns(
      saved,
      ["unitOfMeasure", "quantity"],
      { hasQuantityAssets: true }
    );
    const byName = (name: string) => result.find((col) => col.name === name);

    expect(byName("quantity")?.position).toBe(5);
    expect(byName("unitOfMeasure")?.position).toBe(6);
    expect(byName("cf_Serial")?.position).toBe(4);
  });

  it("shows Unit of measure right after a shown Total quantity", () => {
    const saved = [
      { name: "name", visible: true, position: 0 },
      { name: "status", visible: true, position: 1 },
      { name: "quantity", visible: true, position: 2 },
      { name: "cf_Serial", visible: true, position: 3 },
    ] as Column[];

    const result = insertMissingDefaultColumns(saved, ["unitOfMeasure"], {
      hasQuantityAssets: true,
    });
    const byName = (name: string) => result.find((col) => col.name === name);

    expect(byName("unitOfMeasure")).toEqual({
      name: "unitOfMeasure",
      visible: true,
      position: 3,
    });
    expect(byName("cf_Serial")?.position).toBe(4);
  });

  it("moves a hidden Unit of measure with a hidden Total quantity to after Status", () => {
    const saved = [
      { name: "name", visible: true, position: 0 },
      { name: "status", visible: true, position: 1 },
      { name: "cf_Serial", visible: true, position: 2 },
      { name: "quantity", visible: false, position: 3 },
      { name: "unitOfMeasure", visible: false, position: 4 },
    ] as Column[];

    const result = insertMissingDefaultColumns(
      saved,
      ["available", "stockStatus"],
      { hasQuantityAssets: true }
    );
    const order = [...result]
      .sort((a, b) => a.position - b.position)
      .map((col) => col.name);

    expect(order).toEqual([
      "name",
      "status",
      "available",
      "quantity",
      "unitOfMeasure",
      "stockStatus",
      "cf_Serial",
    ]);
  });

  it("puts the first quantity column right after Status when the set has none", () => {
    const saved = [
      { name: "name", visible: true, position: 0 },
      { name: "status", visible: true, position: 1 },
      { name: "cf_Serial", visible: true, position: 2 },
    ] as Column[];

    const result = insertMissingDefaultColumns(saved, ["available"], {
      hasQuantityAssets: true,
    });
    const order = [...result]
      .sort((a, b) => a.position - b.position)
      .map((col) => col.name);

    expect(order).toEqual(["name", "status", "available", "cf_Serial"]);
  });
});
