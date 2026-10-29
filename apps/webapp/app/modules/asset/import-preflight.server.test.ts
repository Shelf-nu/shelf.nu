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
    ).toEqual({ errors: [], totalErrors: 0 });
  });

  it("reports EVERY bad row, not just the first", () => {
    const { errors } = validateContentImportRows({
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
    const { errors } = validateContentImportRows({
      data: [row(), row({ title: "bad", type: "QUANTITY_TRACKED" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
  });

  it("rejects a QUANTITY_TRACKED row that is missing consumptionType", () => {
    const { errors } = validateContentImportRows({
      data: [row({ type: "QUANTITY_TRACKED", quantity: "5" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("consumptionType");
  });

  it("rejects an asset model on a QUANTITY_TRACKED row", () => {
    const { errors } = validateContentImportRows({
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
    const { errors } = validateContentImportRows({
      data: [row({ "cf:Price,type:amount": "$1,2ab" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
  });

  it("rejects a header whose type contradicts an existing custom field", () => {
    const { errors } = validateContentImportRows({
      data: [row({ "cf:Price,type:text": "free text" })],
      existingCustomFields: [
        { name: "Price", type: "AMOUNT", format: "PLAIN" },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("AMOUNT");
  });

  it("reports a contradicting header once, not once per row", () => {
    // The header is a property of the file. Reported per row it would fill the
    // whole error budget with copies of one sentence.
    const { errors } = validateContentImportRows({
      data: Array.from({ length: 40 }, () =>
        row({ "cf:Price,type:text": "free text" })
      ),
      existingCustomFields: [
        { name: "Price", type: "AMOUNT", format: "PLAIN" },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
  });

  it("matches existing custom fields case-insensitively", () => {
    const { errors } = validateContentImportRows({
      data: [row({ "cf:PRICE,type:text": "free text" })],
      existingCustomFields: [
        { name: "price", type: "AMOUNT", format: "PLAIN" },
      ],
    });

    expect(errors).toHaveLength(1);
  });

  it("refuses a value that is not a web link for an existing Link field", () => {
    const { errors } = validateContentImportRows({
      data: [
        row({ "cf:Manual,type:text": "https://example.com/manual.pdf" }),
        row({ "cf:Manual,type:text": "see shelf" }),
      ],
      existingCustomFields: [{ name: "Manual", type: "TEXT", format: "LINK" }],
    });

    expect(errors).toEqual([
      {
        row: 3,
        title: "Invalid custom field value",
        message:
          "Custom field 'Manual': Enter just the link, with no spaces or other text. The value we found is: 'see shelf'.",
      },
    ]);
  });

  it("refuses a file over the row cap without validating rows", () => {
    const { errors } = validateContentImportRows({
      data: Array.from({ length: MAX_CONTENT_IMPORT_ROWS + 1 }, () => row()),
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toContain(
      MAX_CONTENT_IMPORT_ROWS.toLocaleString("en-US")
    );
  });

  it("accepts files up to a caller's higher row cap", () => {
    const data = Array.from({ length: MAX_CONTENT_IMPORT_ROWS + 1 }, () =>
      row()
    );

    expect(
      validateContentImportRows({
        data,
        existingCustomFields: [],
        maxRows: 10_000,
      }).errors
    ).toEqual([]);
    expect(
      validateContentImportRows({
        data,
        existingCustomFields: [],
        maxRows: 1000,
      }).errors[0].message
    ).toContain("1,000");
  });

  it("caps the listed errors but still counts the rest", () => {
    // The count is what the import page reports; truncating the list must not
    // truncate it, or a 125-problem file reads as exactly 100.
    const { errors, totalErrors } = validateContentImportRows({
      data: Array.from({ length: MAX_REPORTED_ROW_ERRORS + 25 }, () =>
        row({ type: "QUANTITY_TRACKED" })
      ),
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(MAX_REPORTED_ROW_ERRORS);
    expect(totalErrors).toBe(MAX_REPORTED_ROW_ERRORS + 25);
  });

  it("rejects a header declaring a type that does not exist", () => {
    const { errors } = validateContentImportRows({
      data: [row({ "cf:Price,type:numbre": "10" })],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("Unknown custom field type");
    expect(errors[0].row).toBe(0);
  });

  it("rejects two columns defining one custom field with different types", () => {
    const { errors } = validateContentImportRows({
      data: [
        row({ "cf:Price,type:text": "free", "cf:PRICE,type:number": "10" }),
      ],
      existingCustomFields: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("Conflicting custom field columns");
  });

  it("rejects a description over 5,000 characters", () => {
    expect(
      validateContentImportRows({
        data: [row(), row({ description: "a".repeat(5123) })],
        existingCustomFields: [],
      })
    ).toEqual({
      errors: [
        {
          row: 3,
          title: "Description too long",
          message:
            'Asset "Aputure 300x": the description is 5,123 characters, but the maximum is 5,000. Shorten it and import again.',
        },
      ],
      totalErrors: 1,
    });
  });

  it("accepts a description of exactly 5,000 characters", () => {
    expect(
      validateContentImportRows({
        data: [row({ description: "a".repeat(5000) })],
        existingCustomFields: [],
      })
    ).toEqual({ errors: [], totalErrors: 0 });
  });

  it("counts a \\r\\n line break in a description as one character", () => {
    // 5,001 UTF-16 units, 5,000 characters as the user counts them.
    expect(
      validateContentImportRows({
        data: [
          row({ description: `${"a".repeat(2500)}\r\n${"a".repeat(2499)}` }),
        ],
        existingCustomFields: [],
      })
    ).toEqual({ errors: [], totalErrors: 0 });
  });

  it("accepts two columns defining one custom field with the SAME type", () => {
    // The importer accepts these today; refusing here would make pre-flight
    // stricter than the code it guards.
    const { errors } = validateContentImportRows({
      data: [row({ "cf:Price,type:text": "a", "cf:PRICE,type:text": "b" })],
      existingCustomFields: [],
    });

    expect(errors).toEqual([]);
  });

  it.each([[""], ["   "], [undefined]])("requires a title (%j)", (title) => {
    const { errors } = validateContentImportRows({
      data: [row(), row({ title } as never)],
      existingCustomFields: [],
    });

    expect(errors).toEqual([
      {
        row: 3,
        title: "Title required",
        message: expect.stringContaining("title column"),
      },
    ]);
  });

  it("names an untitled row by its line in other messages", () => {
    const { errors } = validateContentImportRows({
      data: [row({ title: "", description: "a".repeat(5001) })],
      existingCustomFields: [],
    });

    expect(errors.map((e) => e.title)).toEqual([
      "Title required",
      "Description too long",
    ]);
    expect(errors[1].message).toContain("The asset on row 2");
  });

  it.each([["yes"], ["No"], [" YES "], [""], ["   "]])(
    "accepts a boolean custom field value of %j",
    (value) => {
      const { errors } = validateContentImportRows({
        data: [row({ "cf:Insured,type:boolean": value })],
        existingCustomFields: [],
      });

      expect(errors).toEqual([]);
    }
  );

  it("rejects a boolean custom field value other than yes or no", () => {
    const { errors } = validateContentImportRows({
      data: [row({ "cf:Insured,type:boolean": "maybe" })],
      existingCustomFields: [],
    });

    expect(errors).toEqual([
      {
        row: 2,
        title: "Invalid custom field value",
        message:
          'Custom field "Insured" accepts only yes or no. The value we found is: "maybe".',
      },
    ]);
  });
});
