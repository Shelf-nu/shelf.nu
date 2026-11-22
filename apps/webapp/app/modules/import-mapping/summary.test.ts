import { describe, expect, it } from "vitest";
import { summarizeMapping } from "./summary";
import type { ColumnMapping } from "./types";

describe("summarizeMapping", () => {
  const col = (target: ColumnMapping["target"]): ColumnMapping => ({
    source: "x",
    target,
    confidence: "high",
    sample: [],
  });

  it("counts the rows and names the custom fields the mapping creates", () => {
    const summary = summarizeMapping({
      columns: [
        col({ kind: "field", name: "title" }),
        col({ kind: "customField", name: "Serial number", type: "TEXT" }),
      ],
      rowCount: 3,
      existingCustomFieldNames: [],
    });
    expect(summary).toEqual({
      rows: 3,
      rowsMayDrop: false,
      newCustomFields: ["Serial number"],
    });
  });

  it("says rows may drop only when a column is skipped", () => {
    const summary = summarizeMapping({
      columns: [col({ kind: "field", name: "title" }), col({ kind: "skip" })],
      rowCount: 3,
      existingCustomFieldNames: [],
    });
    expect(summary.rowsMayDrop).toBe(true);
  });

  it("does not count Shelf's own id column as a skip that can empty a row", () => {
    const summary = summarizeMapping({
      columns: [
        { ...col({ kind: "skip" }), source: "id" },
        col({ kind: "field", name: "title" }),
      ],
      rowCount: 2,
      existingCustomFieldNames: [],
    });
    expect(summary.rowsMayDrop).toBe(false);
  });

  it("does not list custom fields the workspace already has", () => {
    const summary = summarizeMapping({
      columns: [
        col({ kind: "customField", name: "serial NUMBER", type: "TEXT" }),
      ],
      rowCount: 1,
      existingCustomFieldNames: ["Serial number"],
    });
    expect(summary.newCustomFields).toEqual([]);
  });
});
