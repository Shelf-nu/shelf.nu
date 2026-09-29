import { describe, expect, it } from "vitest";

import {
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
