import { describe, expect, it } from "vitest";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import { applyMapping } from "./apply";
import type { ColumnMapping } from "./types";
import {
  MAX_HEADER_LENGTH,
  MAX_MAPPED_COLUMNS,
  MAX_MAPPING_FIELD_LENGTH,
  columnMappingListSchema,
  findDuplicateTargets,
} from "./types";

/** Builds a mapping entry with no samples. */
function col(source: string, target: ColumnMapping["target"]): ColumnMapping {
  return { source, target, confidence: "high", sample: [] };
}

const FILE = [
  ["Item Name", "Serial No.", "Notes", "Legacy ID"],
  ["Dell", "5CG3", "spare", "X1"],
  ["HP"],
];

const MAPPING: ColumnMapping[] = [
  col("Item Name", { kind: "field", name: "title" }),
  col("Serial No.", {
    kind: "customField",
    name: "Serial number",
    type: "TEXT",
  }),
  col("Notes", { kind: "field", name: "description" }),
  col("Legacy ID", { kind: "skip" }),
];

describe("applyMapping", () => {
  it("renames headers, drops skipped columns and pads ragged rows", () => {
    expect(applyMapping(FILE, MAPPING)).toEqual([
      ["title", "cf:Serial number, type:text", "description"],
      ["Dell", "5CG3", "spare"],
      ["HP", "", ""],
    ]);
  });

  it("drops rows whose only values were in skipped columns", () => {
    const file = [
      ["Item Name", "Legacy ID"],
      ["Dell", "X1"],
      ["", "X2"],
      ["  ", "X3"],
    ];
    expect(
      applyMapping(file, [
        col("Item Name", { kind: "field", name: "title" }),
        col("Legacy ID", { kind: "skip" }),
      ])
    ).toEqual([["title"], ["Dell"]]);
  });

  it("produces headers the existing importer accepts", () => {
    const rows = extractCSVDataFromContentImport(
      applyMapping(FILE, MAPPING),
      ASSET_CSV_HEADERS
    );
    expect(rows[0]).toMatchObject({
      title: "Dell",
      "cf:Serial number, type:text": "5CG3",
      description: "spare",
    });
  });

  it("refuses two columns aimed at one destination", () => {
    const clash = [
      col("Item Name", { kind: "field", name: "title" }),
      col("Serial No.", {
        kind: "customField",
        name: "serial NUMBER",
        type: "TEXT",
      }),
      col("Notes", { kind: "field", name: "title" }),
      col("Legacy ID", {
        kind: "customField",
        name: "Serial number",
        type: "TEXT",
      }),
    ];
    expect(() => applyMapping(FILE, clash)).toThrow(/one column only/);
    expect([...findDuplicateTargets(clash).values()]).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it("refuses a mapping made for another file", () => {
    expect(() => applyMapping(FILE, MAPPING.slice(0, 3))).toThrow(
      /does not match/
    );
    const renamed = [col("Title", { kind: "field", name: "title" })];
    expect(() => applyMapping([["Name"], ["a"]], renamed)).toThrow(
      /does not match/
    );
  });

  it("refuses a mapping that skips every column", () => {
    expect(() =>
      applyMapping([["a"], ["1"]], [col("a", { kind: "skip" })])
    ).toThrow(/set to Skip/);
  });
});

describe("applyMapping with a quantity choice", () => {
  const STOCK_FILE = [
    ["Entry Name", "Quantity", "Sortly ID"],
    ["Cable", "10", "S1"],
    ["Battery", "1", "S2"],
    ["", "", "S3"],
  ];
  const STOCK_MAPPING: ColumnMapping[] = [
    col("Entry Name", { kind: "field", name: "title" }),
    col("Quantity", { kind: "field", name: "quantity" }),
    col("Sortly ID", { kind: "skip" }),
  ];

  it("tracks every row by quantity with the chosen consumption type", () => {
    expect(applyMapping(STOCK_FILE, STOCK_MAPPING, "TWO_WAY")).toEqual([
      ["title", "quantity", "type", "consumptionType"],
      ["Cable", "10", "QUANTITY_TRACKED", "TWO_WAY"],
      ["Battery", "1", "QUANTITY_TRACKED", "TWO_WAY"],
    ]);
  });

  it("keeps a mapped consumptionType column and adds only the type", () => {
    const rows = applyMapping(
      [
        ["Name", "Qty", "Usage"],
        ["Tape", "4", "ONE_WAY"],
      ],
      [
        col("Name", { kind: "field", name: "title" }),
        col("Qty", { kind: "field", name: "quantity" }),
        col("Usage", { kind: "field", name: "consumptionType" }),
      ],
      "TWO_WAY"
    );
    expect(rows).toEqual([
      ["title", "quantity", "consumptionType", "type"],
      ["Tape", "4", "ONE_WAY", "QUANTITY_TRACKED"],
    ]);
  });

  it("adds nothing for individual assets", () => {
    expect(applyMapping(STOCK_FILE, STOCK_MAPPING, "INDIVIDUAL")).toEqual(
      applyMapping(STOCK_FILE, STOCK_MAPPING)
    );
  });

  it("refuses a stock choice when the mapping has no quantity or has a type", () => {
    expect(() =>
      applyMapping(
        [["Name"], ["a"]],
        [col("Name", { kind: "field", name: "title" })],
        "ONE_WAY"
      )
    ).toThrow("quantity");
    expect(() =>
      applyMapping(
        [
          ["Name", "Qty", "type"],
          ["a", "2", "QUANTITY_TRACKED"],
        ],
        [
          col("Name", { kind: "field", name: "title" }),
          col("Qty", { kind: "field", name: "quantity" }),
          col("type", { kind: "field", name: "type" }),
        ],
        "ONE_WAY"
      )
    ).toThrow("quantity");
  });
});

describe("columnMappingListSchema", () => {
  it("accepts a custom field named like type: model, which the importer parses", () => {
    const columns = [
      col("Kind", { kind: "customField", name: "type: model", type: "TEXT" }),
    ];
    expect(columnMappingListSchema.safeParse(columns).success).toBe(true);
    const [row] = extractCSVDataFromContentImport(
      applyMapping([["Kind"], ["X1"]], columns),
      ASSET_CSV_HEADERS
    );
    expect(row).toMatchObject({ "cf:type: model, type:text": "X1" });
  });

  it("accepts an existing custom field with a name over 100 characters", () => {
    const longName = "Long field ".repeat(15).trim();
    const result = columnMappingListSchema.safeParse([
      col("a", { kind: "customField", name: longName, type: "TEXT" }),
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects custom field names the importer cannot parse", () => {
    const result = columnMappingListSchema.safeParse([
      col("a", { kind: "customField", name: "Size, cm", type: "TEXT" }),
    ]);
    expect(result.success).toBe(false);
  });

  it("fits the largest mapping the analysis accepts in the form field limit", () => {
    // Control characters are the worst case: each one is a six-character escape.
    const longest = "\u0001".repeat(MAX_HEADER_LENGTH);
    const columns = Array.from({ length: MAX_MAPPED_COLUMNS }, () =>
      col(longest, {
        kind: "customField",
        name: longest,
        type: "MULTILINE_TEXT",
      })
    );
    expect(columnMappingListSchema.safeParse(columns).success).toBe(true);
    expect(JSON.stringify(columns).length).toBeLessThanOrEqual(
      MAX_MAPPING_FIELD_LENGTH
    );
  });

  it("rejects targets outside the importer's headers", () => {
    const result = columnMappingListSchema.safeParse([
      { ...col("a", { kind: "skip" }), target: { kind: "field", name: "id" } },
    ]);
    expect(result.success).toBe(false);
  });
});
