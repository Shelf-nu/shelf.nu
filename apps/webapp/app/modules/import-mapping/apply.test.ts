import { describe, expect, it } from "vitest";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import { applyMapping } from "./apply";
import type { ColumnMapping } from "./types";
import { columnMappingListSchema, findDuplicateTargets } from "./types";

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

  it("rejects targets outside the importer's headers", () => {
    const result = columnMappingListSchema.safeParse([
      { ...col("a", { kind: "skip" }), target: { kind: "field", name: "id" } },
    ]);
    expect(result.success).toBe(false);
  });
});
