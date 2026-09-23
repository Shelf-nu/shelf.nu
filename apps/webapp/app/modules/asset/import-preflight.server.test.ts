import { describe, expect, it } from "vitest";
import {
  MAX_CONTENT_IMPORT_ROWS,
  MAX_REPORTED_ROW_ERRORS,
  validateContentImportRows,
} from "./import-preflight.server";
import type { CreateAssetFromContentImportPayload } from "./types";

/** Minimal valid INDIVIDUAL row; override per test. */
function row(
  overrides: Partial<CreateAssetFromContentImportPayload> = {}
): CreateAssetFromContentImportPayload {
  return {
    key: `key-${Math.random()}`,
    title: "Aputure 300x",
    ...overrides,
  } as CreateAssetFromContentImportPayload;
}

describe("validateContentImportRows", () => {
  it("returns no errors for a clean file", () => {
    expect(
      validateContentImportRows({
        data: [row(), row({ title: "Arri AS-2" })],
        existingCustomFields: [],
      })
    ).toEqual([]);
  });

  it("reports EVERY bad row, not just the first", () => {
    const errors = validateContentImportRows({
      data: [
        row({ title: "A", type: "QUANTITY_TRACKED" }),
        row({ title: "B" }),
        row({ title: "C", type: "QUANTITY_TRACKED" }),
      ],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.row)).toEqual([2, 4]);
  });

  it("numbers rows as spreadsheet lines (header is row 1)", () => {
    const errors = validateContentImportRows({
      data: [row(), row({ title: "bad", type: "QUANTITY_TRACKED" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
  });

  it("rejects a QUANTITY_TRACKED row that is missing consumptionType", () => {
    const errors = validateContentImportRows({
      data: [row({ type: "QUANTITY_TRACKED", quantity: "5" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("consumptionType");
  });

  it("rejects an asset model on a QUANTITY_TRACKED row", () => {
    const errors = validateContentImportRows({
      data: [
        row({
          type: "QUANTITY_TRACKED",
          quantity: "5",
          consumptionType: "ONE_WAY",
          assetModel: "Canon C70",
        }),
      ],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("Asset model not allowed");
  });

  it("rejects a non-numeric AMOUNT custom field value", () => {
    const errors = validateContentImportRows({
      data: [row({ "cf:Price,type:amount": "$1,2ab" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
  });

  it("rejects a header whose type contradicts an existing custom field", () => {
    const errors = validateContentImportRows({
      data: [row({ "cf:Price,type:text": "free text" })],
      existingCustomFields: [{ name: "Price", type: "AMOUNT" }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("AMOUNT");
  });

  it("reports a contradicting header once, not once per row", () => {
    // The header is a property of the file. Reported per row it would fill the
    // whole error budget with copies of one sentence.
    const errors = validateContentImportRows({
      data: Array.from({ length: 40 }, () =>
        row({ "cf:Price,type:text": "free text" })
      ),
      existingCustomFields: [{ name: "Price", type: "AMOUNT" }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
  });

  it("matches existing custom fields case-insensitively", () => {
    const errors = validateContentImportRows({
      data: [row({ "cf:PRICE,type:text": "free text" })],
      existingCustomFields: [{ name: "price", type: "AMOUNT" }],
    });

    expect(errors).toHaveLength(1);
  });

  it("refuses a file over the row cap without validating rows", () => {
    const errors = validateContentImportRows({
      data: Array.from({ length: MAX_CONTENT_IMPORT_ROWS + 1 }, () => row()),
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toContain(String(MAX_CONTENT_IMPORT_ROWS));
  });

  it("caps how many errors it returns", () => {
    const errors = validateContentImportRows({
      data: Array.from({ length: MAX_REPORTED_ROW_ERRORS + 25 }, () =>
        row({ type: "QUANTITY_TRACKED" })
      ),
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(MAX_REPORTED_ROW_ERRORS);
  });
});
