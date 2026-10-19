import { CustomFieldType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { IMPORT_FIELDS, isAssetCsvHeader } from "./fields";
import { buildColumnSamples, proposeByRules } from "./heuristics";
import { SYNONYM_GROUPS, lookupSynonym, normalizeHeader } from "./synonyms";
import { customFieldNameSchema } from "./types";

const ALL_HEADINGS = SYNONYM_GROUPS.flatMap(({ headings }) => headings);
const compact = (text: string) => normalizeHeader(text).replace(/ /g, "");

describe("SYNONYM_GROUPS", () => {
  it("is generous", () => {
    expect(ALL_HEADINGS.length).toBeGreaterThanOrEqual(60);
  });

  it("points every heading at a destination the importer accepts", () => {
    for (const { target } of SYNONYM_GROUPS) {
      if (target.kind === "field") {
        expect(isAssetCsvHeader(target.name), target.name).toBe(true);
      } else {
        expect(customFieldNameSchema.safeParse(target.name).success).toBe(true);
        expect(Object.values(CustomFieldType)).toContain(target.type);
      }
    }
  });

  it("lists each heading once", () => {
    const normalized = ALL_HEADINGS.map(normalizeHeader);
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("never lists a heading that already matches a Shelf field by name", () => {
    const shelfNames = new Set(IMPORT_FIELDS.map(({ name }) => compact(name)));
    expect(
      ALL_HEADINGS.filter((heading) => shelfNames.has(compact(heading)))
    ).toEqual([]);
  });

  it("ignores case and punctuation", () => {
    expect(lookupSynonym("S/N")).toEqual(lookupSynonym("sn"));
    expect(lookupSynonym("  Serial No. ")).toEqual({
      kind: "customField",
      name: "Serial number",
      type: "TEXT",
    });
    expect(lookupSynonym("Sortly ID")).toBeUndefined();
  });
});

describe("common export headings", () => {
  /** Heading, a sample value, and the destination the rules must pick. */
  const CASES: [string, string, string][] = [
    ["Item Name", "Dell Latitude", "field:title"],
    ["Asset Name", "Projector", "field:title"],
    ["Product", "Drill", "field:title"],
    ["Qty", "1", "field:quantity"],
    ["Quantity on hand", "1", "field:quantity"],
    ["Serial", "S1", "cf:Serial number:TEXT"],
    ["Serial Number", "S1", "cf:Serial number:TEXT"],
    ["S/N", "S1", "cf:Serial number:TEXT"],
    ["Model", "Latitude 5540", "field:assetModel"],
    ["Manufacturer", "Dell", "cf:Manufacturer:TEXT"],
    ["Brand", "Dell", "cf:Manufacturer:TEXT"],
    ["Purchase Date", "2024-01-02", "cf:Purchase date:DATE"],
    ["Date Purchased", "2024-01-02", "cf:Purchase date:DATE"],
    ["Cost", "100", "field:valuation"],
    ["Price", "100", "field:valuation"],
    ["Value", "100", "field:valuation"],
    ["Location", "Sofia", "field:location"],
    ["Room", "B12", "field:location"],
    ["Site", "HQ", "field:location"],
    ["Building", "North", "field:location"],
    ["Assigned To", "Ana", "field:custodian"],
    ["Owner", "Ana", "field:custodian"],
    ["Custodian", "Ana", "field:custodian"],
    ["Holder", "Ana", "field:custodian"],
    ["Status", "In use", "cf:Previous status:OPTION"],
    ["Notes", "spare", "field:description"],
    ["Comments", "spare", "field:description"],
    ["Description", "spare", "field:description"],
    ["Category", "Laptops", "field:category"],
    ["Type", "Laptop", "field:category"],
    ["Group", "IT", "field:category"],
    ["Tags", "a, b", "field:tags"],
    ["Barcode", "ABC1234", "field:barcode_Code128"],
    ["SKU", "SKU-1", "cf:SKU:TEXT"],
    ["Asset Tag", "AT-1", "cf:Asset tag:TEXT"],
    ["Asset ID", "AT-1", "cf:Asset tag:TEXT"],
    ["Image", "https://x.test/a.png", "field:imageUrl"],
    ["Photo URL", "https://x.test/a.png", "field:imageUrl"],
    ["Price (EUR)", "499", "field:valuation"],
    ["Assigned", "Ana", "field:custodian"],
    ["Date Acquired", "2021-03-12", "cf:Purchase date:DATE"],
    ["Warranty", "36 months", "cf:Warranty:TEXT"],
    ["Warranty Expires", "2026-03-01", "cf:Warranty expiry:DATE"],
  ];

  it.each(CASES)("maps %s", (heading, sample, expected) => {
    const { headers, samples } = buildColumnSamples([[heading], [sample]]);
    const [column] = proposeByRules(headers, samples, [], {
      canUseBarcodes: true,
    }).columns;
    const { target } = column;
    const actual =
      target.kind === "field"
        ? `field:${target.name}`
        : target.kind === "customField"
        ? `cf:${target.name}:${target.type}`
        : "skip";
    expect(actual).toBe(expected);
  });
});
