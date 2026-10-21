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

  it("checks the values of an exact `type` heading like any other", () => {
    const proposal = propose([["type"], ["Laptop"]]);
    expect(proposal.columns[0]).toMatchObject({
      target: { kind: "field", name: "category" },
      confidence: "low",
    });
  });

  it("keeps an exact `type` heading whose values are asset types", () => {
    const proposal = propose([["type"], ["QUANTITY_TRACKED"]]);
    expect(proposal.columns[0]).toMatchObject({
      target: { kind: "field", name: "type" },
      confidence: "high",
    });
  });

  it("lets a sure match keep a destination a guess reached first", () => {
    const proposal = propose([
      ["Type", "Category"],
      ["Laptop", "Electronics"],
    ]);
    expect(proposal.columns.map((column) => column.target)).toEqual([
      { kind: "skip" },
      { kind: "field", name: "category" },
    ]);
    expect(proposal.columns[1].confidence).toBe("high");
  });

  it("skips Shelf's `id` column even when a custom field is named ID", () => {
    const proposal = propose(
      [
        ["id", "title"],
        ["clx123", "Laptop"],
      ],
      [{ name: "ID", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0].target).toEqual({ kind: "skip" });
    expect(isAlreadyShelfFormat(proposal.columns)).toBe(true);
  });

  it("still maps an `ID` heading to the workspace's ID custom field", () => {
    const proposal = propose(
      [["ID"], ["A-1"]],
      [{ name: "ID", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0].target).toEqual({
      kind: "customField",
      name: "ID",
      type: "TEXT",
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

  it("never proposes a barcode field without the add-on, however it is named", () => {
    const rows = [
      ["barcode_Code128", "Barcode EAN13", "barcode_datamatrix"],
      ["ABC1234", "4006381333931", "DM1234"],
    ];
    expect(propose(rows).columns.map((column) => column.target)).toEqual([
      { kind: "skip" },
      { kind: "skip" },
      { kind: "skip" },
    ]);
    expect(
      propose(rows, [], true).columns.map((column) => column.target)
    ).toEqual([
      { kind: "field", name: "barcode_Code128" },
      { kind: "field", name: "barcode_EAN13" },
      { kind: "field", name: "barcode_DataMatrix" },
    ]);
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

describe("existing custom fields with look-alike names", () => {
  const fields = [
    { name: "Asset ID", type: CustomFieldType.TEXT },
    { name: "Asset-ID", type: CustomFieldType.NUMBER },
  ];

  it("matches the field whose name is exactly the heading", () => {
    const proposal = propose(
      [
        ["Asset-ID", "asset id"],
        ["1", "A1"],
      ],
      fields
    );
    expect(proposal.columns.map((column) => column.target)).toEqual([
      { kind: "customField", name: "Asset-ID", type: "NUMBER" },
      { kind: "customField", name: "Asset ID", type: "TEXT" },
    ]);
  });

  it("does not guess between fields that differ only by punctuation", () => {
    const proposal = propose([["Asset_ID"], ["A1"]], fields);
    const target = proposal.columns[0].target;
    expect(
      target.kind === "customField" &&
        (target.name === "Asset ID" || target.name === "Asset-ID")
    ).toBe(false);
  });

  it("still finds a single field by its punctuation-free name", () => {
    const proposal = propose(
      [["warranty_cost"], ["12"]],
      [{ name: "Warranty cost", type: CustomFieldType.AMOUNT }]
    );
    expect(proposal.columns[0].target).toEqual({
      kind: "customField",
      name: "Warranty cost",
      type: "AMOUNT",
    });
  });
});

describe("headings in non-Latin scripts", () => {
  it("never matches an existing field just because both have no Latin letters", () => {
    const proposal = propose(
      [["数量"], ["3"]],
      [{ name: "品名", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0].target).not.toEqual(
      expect.objectContaining({ kind: "customField", name: "品名" })
    );
  });

  it("matches an existing field written in the same script", () => {
    const proposal = propose(
      [["品名"], ["ドリル"]],
      [{ name: "品名", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0].target).toEqual({
      kind: "customField",
      name: "品名",
      type: "TEXT",
    });
  });

  it("does not match a punctuation-only heading to anything", () => {
    const proposal = propose(
      [["---"], ["x"]],
      [{ name: "***", type: CustomFieldType.TEXT }]
    );
    expect(proposal.columns[0].target).toEqual({ kind: "skip" });
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
