import { describe, expect, it } from "vitest";
import { readImportRowErrors, spreadsheetRowNumber } from "./import-row-errors";

describe("spreadsheetRowNumber", () => {
  it("puts the first data row on row 2, under the header", () => {
    expect(spreadsheetRowNumber(0)).toBe(2);
    expect(spreadsheetRowNumber(9)).toBe(11);
  });
});

describe("readImportRowErrors", () => {
  it("reads the row errors and total an import refused a file with", () => {
    const rowErrors = [{ row: 3, title: "Invalid email", message: "Bad" }];

    expect(readImportRowErrors({ rowErrors, totalErrors: 7 })).toEqual({
      rowErrors,
      totalRowErrors: 7,
    });
  });

  it("reads nothing from an error that carries no row errors", () => {
    expect(readImportRowErrors({ userId: "u-1" })).toEqual({
      rowErrors: null,
      totalRowErrors: null,
    });
    expect(readImportRowErrors(undefined)).toEqual({
      rowErrors: null,
      totalRowErrors: null,
    });
  });
});
