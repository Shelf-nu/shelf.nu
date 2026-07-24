import { describe, expect, it } from "vitest";

import {
  appendMissingDefaultFields,
  columnsLabelsMap,
  defaultFields,
  fixedFields,
  type Column,
} from "./helpers";

describe("asset index column metadata", () => {
  it("registers QR label assignment as a fixed field with a user-facing label", () => {
    expect(fixedFields).toContain("qrLabelApplied");
    expect(columnsLabelsMap.qrLabelApplied).toBe("Has ID Assigned");
  });

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
    const qrLabelColumn = defaultFields.find(
      (column) => column.name === "qrLabelApplied"
    );

    expect(createdColumn?.visible).toBe(true);
    expect(updatedColumn).toEqual(expect.objectContaining({ visible: true }));
    expect(qrLabelColumn).toEqual(expect.objectContaining({ visible: false }));
    expect(updatedColumn && createdColumn).toBeTruthy();
    expect(updatedColumn?.position).toBe((createdColumn?.position ?? -1) + 1);

    const positions = defaultFields.map((column) => column.position);
    const expectedPositions = positions.map((_, index) => index);
    expect(positions).toEqual(expectedPositions);
  });
});

describe("appendMissingDefaultFields", () => {
  it("preserves legacy positions and appends new defaults without collisions", () => {
    const legacyColumns: Column[] = defaultFields
      .filter(({ name }) => name !== "qrLabelApplied")
      .map((column, position) => ({ ...column, position }));

    const result = appendMissingDefaultFields(legacyColumns, [
      "qrLabelApplied",
    ]);

    expect(result.slice(0, legacyColumns.length)).toEqual(legacyColumns);
    expect(result.at(-1)).toEqual({
      name: "qrLabelApplied",
      visible: false,
      position: legacyColumns.length,
    });
    expect(new Set(result.map(({ position }) => position)).size).toBe(
      result.length
    );
  });
});
