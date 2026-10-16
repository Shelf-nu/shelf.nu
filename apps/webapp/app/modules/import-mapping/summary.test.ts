import { describe, expect, it } from "vitest";
import { buildColumnStats, summarizeMapping } from "./summary";
import type { ColumnMapping } from "./types";

const FILE = [
  ["Where", "Kind", "Serial"],
  ["Sofia", "Laptop", "S1"],
  ["sofia ", "Camera", "S2"],
  ["Berlin", "", "S3"],
];

describe("buildColumnStats", () => {
  it("counts distinct values the workspace does not have, ignoring case", () => {
    const stats = buildColumnStats(FILE, {
      categories: ["laptop"],
      locations: ["Berlin"],
    });
    expect(stats[0]).toEqual({ newCategories: 2, newLocations: 1 });
    expect(stats[1]).toEqual({ newCategories: 1, newLocations: 2 });
  });
});

describe("summarizeMapping", () => {
  const col = (target: ColumnMapping["target"]): ColumnMapping => ({
    source: "x",
    target,
    confidence: "high",
    sample: [],
  });

  it("reads the counts of whichever columns map to category and location", () => {
    const stats = buildColumnStats(FILE, { categories: [], locations: [] });
    const summary = summarizeMapping({
      columns: [
        col({ kind: "field", name: "location" }),
        col({ kind: "field", name: "category" }),
        col({ kind: "customField", name: "Serial number", type: "TEXT" }),
      ],
      stats,
      rowCount: 3,
      existingCustomFieldNames: [],
    });
    expect(summary).toEqual({
      rows: 3,
      newCustomFields: ["Serial number"],
      newCategories: 2,
      newLocations: 2,
    });
  });

  it("does not list custom fields the workspace already has", () => {
    const summary = summarizeMapping({
      columns: [
        col({ kind: "customField", name: "serial NUMBER", type: "TEXT" }),
      ],
      stats: [{ newCategories: 0, newLocations: 0 }],
      rowCount: 1,
      existingCustomFieldNames: ["Serial number"],
    });
    expect(summary.newCustomFields).toEqual([]);
  });
});
