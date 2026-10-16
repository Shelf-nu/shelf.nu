import { CustomFieldType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  QUANTITY_WITHOUT_TYPE_NOTE,
  buildColumnSamples,
  isAlreadyShelfFormat,
  proposeByRules,
} from "./heuristics";

/** Proposes for a header row plus data rows, with no existing fields. */
function propose(
  rows: string[][],
  existing: { name: string; type: CustomFieldType }[] = [],
  canUseBarcodes = false
) {
  const { headers, samples } = buildColumnSamples(rows);
  return proposeByRules(headers, samples, existing, { canUseBarcodes });
}

describe("buildColumnSamples", () => {
  it("keeps up to 3 non-empty cells per column, cut to 60 chars", () => {
    const long = "x".repeat(80);
    const { headers, samples } = buildColumnSamples([
      ["﻿Name ", "Notes"],
      ["A", ""],
      ["B", long],
      ["C", ""],
      ["D", "ok"],
    ]);
    expect(headers).toEqual(["Name", "Notes"]);
    expect(samples[0]).toEqual(["A", "B", "C"]);
    expect(samples[1]).toEqual(["x".repeat(60), "ok"]);
  });

  it("tolerates ragged rows", () => {
    const { samples } = buildColumnSamples([["a", "b"], ["1"]]);
    expect(samples).toEqual([["1"], []]);
  });
});

describe("proposeByRules", () => {
  it("maps a messy export by synonyms and skips what it cannot place", () => {
    const proposal = propose([
      [
        "Item Name",
        "Serial No.",
        "Qty",
        "Purchased",
        "Where",
        "Who has it",
        "Notes",
        "Legacy ID",
      ],
      [
        "Dell Latitude",
        "5CG31",
        "1",
        "03/12/2023",
        "Sofia",
        "Ana",
        "spare",
        "X-991",
      ],
    ]);

    expect(proposal.source).toBe("rules");
    expect(proposal.columns.map((column) => column.target)).toEqual([
      { kind: "field", name: "title" },
      { kind: "customField", name: "Serial number", type: "TEXT" },
      { kind: "field", name: "quantity" },
      { kind: "customField", name: "Purchase date", type: "DATE" },
      { kind: "field", name: "location" },
      { kind: "field", name: "custodian" },
      { kind: "field", name: "description" },
      { kind: "skip" },
    ]);
    expect(proposal.columns[7].confidence).toBe("low");
    expect(proposal.columns[0].confidence).toBe("high");
    expect(proposal.notes.join(" ")).toContain("YYYY-MM-DD");
  });

  it("matches headers case- and separator-insensitively", () => {
    const proposal = propose([
      ["TITLE", "Unit of measure", "min_quantity"],
      ["a", "kg", "2"],
    ]);
    expect(proposal.columns.map((column) => column.target)).toEqual([
      { kind: "field", name: "title" },
      { kind: "field", name: "unitOfMeasure" },
      { kind: "field", name: "minQuantity" },
    ]);
  });

  it("reads a Type column of categories as category, not asset type", () => {
    const proposal = propose([["Type"], ["Laptop"]]);
    expect(proposal.columns[0]).toMatchObject({
      target: { kind: "field", name: "category" },
      confidence: "low",
    });
  });

  it("prefers the workspace's existing custom field and its type", () => {
    const proposal = propose(
      [
        ["Serial", "Warranty Cost"],
        ["S1", "12"],
      ],
      [
        { name: "serial number", type: CustomFieldType.MULTILINE_TEXT },
        { name: "Warranty cost", type: CustomFieldType.AMOUNT },
      ]
    );
    expect(proposal.columns.map((column) => column.target)).toEqual([
      {
        kind: "customField",
        name: "serial number",
        type: "MULTILINE_TEXT",
      },
      { kind: "customField", name: "Warranty cost", type: "AMOUNT" },
    ]);
  });

  it("never proposes two columns for one destination", () => {
    const proposal = propose([
      ["Name", "Item"],
      ["a", "b"],
    ]);
    expect(proposal.columns[0].target).toEqual({
      kind: "field",
      name: "title",
    });
    expect(proposal.columns[1].target).toEqual({ kind: "skip" });
  });

  it("proposes barcode synonyms only with the barcode add-on", () => {
    const rows = [["Barcode"], ["ABC123"]];
    expect(propose(rows).columns[0].target).toEqual({ kind: "skip" });
    expect(propose(rows, [], true).columns[0].target).toEqual({
      kind: "field",
      name: "barcode_Code128",
    });
  });

  it("warns that quantities above 1 need a type column", () => {
    expect(propose([["Qty"], ["1"]]).notes).toContain(
      QUANTITY_WITHOUT_TYPE_NOTE
    );
    expect(
      propose([
        ["Qty", "type"],
        ["12", "QUANTITY_TRACKED"],
      ]).notes
    ).not.toContain(QUANTITY_WITHOUT_TYPE_NOTE);
  });

  it("keeps cf: headers and refuses malformed ones", () => {
    const proposal = propose([
      ["cf: Serial number,type:text", "cf:Weight, type:weight"],
      ["a", "b"],
    ]);
    expect(proposal.columns[0].target).toEqual({
      kind: "customField",
      name: "Serial number",
      type: "TEXT",
    });
    expect(proposal.columns[1].target).toEqual({ kind: "skip" });
  });
});

describe("cf: headers against existing custom fields", () => {
  it("takes the stored type when the header's type contradicts it", () => {
    const proposal = propose(
      [["cf:Brand, type:option"], ["amd"]],
      [{ name: "brand", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0]).toMatchObject({
      target: { kind: "customField", name: "brand", type: "TEXT" },
      confidence: "low",
    });
    expect(isAlreadyShelfFormat(proposal.columns)).toBe(false);
  });
});

describe("isAlreadyShelfFormat", () => {
  it("is true for the Shelf template headers", () => {
    const proposal = propose([
      [
        "id",
        "title",
        "category",
        "type",
        "cf: Serial number,type:text",
        "cf:purchase date, type:date",
      ],
      ["x", "AMD Ryzen", "CPU", "INDIVIDUAL", "S1", "2024-02-22"],
    ]);
    expect(isAlreadyShelfFormat(proposal.columns)).toBe(true);
  });

  it("is false once a column has to be renamed", () => {
    const proposal = propose([["Name"], ["a"]]);
    expect(isAlreadyShelfFormat(proposal.columns)).toBe(false);
  });
});
