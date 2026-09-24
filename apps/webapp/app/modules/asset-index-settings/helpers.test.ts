import { describe, expect, it } from "vitest";

import { columnsLabelsMap, defaultFields, fixedFields } from "./helpers";

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
});
