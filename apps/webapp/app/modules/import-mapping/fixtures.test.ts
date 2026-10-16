/**
 * The import mapping fixtures (`test/fixtures/import-mapping/`), parsed with
 * the importer's own CSV parser and proposed by the rules, map the way the
 * review screen promises.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCsv } from "~/utils/csv.server";
import {
  QUANTITY_WITHOUT_TYPE_NOTE,
  buildColumnSamples,
  proposeByRules,
} from "./heuristics";
import type { ColumnTarget } from "./types";

// why: csv.server's import graph reaches lottie, which draws on a canvas at
// import time; happy-dom has no canvas.
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

/** Proposes a mapping for one fixture, with no existing custom fields. */
async function proposeFixture(name: string, canUseBarcodes = false) {
  const file = readFileSync(
    resolve(__dirname, "../../../test/fixtures/import-mapping", name)
  );
  const csv = await parseCsv(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  );
  const { headers, samples } = buildColumnSamples(csv);
  return proposeByRules(headers, samples, [], { canUseBarcodes });
}

/** Source heading to destination, for compact assertions. */
function targets(columns: { source: string; target: ColumnTarget }[]) {
  return Object.fromEntries(
    columns.map(({ source, target }) => [
      source,
      target.kind === "field"
        ? target.name
        : target.kind === "customField"
        ? `cf:${target.name}:${target.type}`
        : "skip",
    ])
  );
}

describe("import mapping fixtures", () => {
  it("maps the messy spreadsheet by rules alone", async () => {
    const proposal = await proposeFixture("messy-spreadsheet.csv");
    expect(targets(proposal.columns)).toEqual({
      "Item Name": "title",
      "Serial No.": "cf:Serial number:TEXT",
      Qty: "quantity",
      Purchased: "cf:Purchase date:DATE",
      Where: "location",
      "Who has it": "custodian",
      Notes: "description",
      "Legacy ID": "skip",
    });
    expect(proposal.notes.join(" ")).toContain('"Purchased" has dates like');
    expect(proposal.notes).toContain(QUANTITY_WITHOUT_TYPE_NOTE);
  });

  it("maps a Sortly-style export", async () => {
    const proposal = await proposeFixture("sortly-export.csv", true);
    expect(targets(proposal.columns)).toMatchObject({
      "Entry Name": "title",
      "Variant Details": "description",
      "Sortly ID": "skip",
      Unit: "unitOfMeasure",
      "Min Level": "minQuantity",
      Price: "valuation",
      // Price took valuation first, so the second money column is skipped.
      Value: "skip",
      Quantity: "quantity",
      Tags: "tags",
      "Barcode/QR1-Data": "barcode_ExternalQR",
      "Primary Folder": "location",
    });
  });

  it("maps an Asset Panda-style export", async () => {
    const proposal = await proposeFixture("asset-panda-export.csv");
    expect(targets(proposal.columns)).toEqual({
      "Asset ID": "cf:Asset tag:TEXT",
      "Asset Name": "title",
      "Serial Number": "cf:Serial number:TEXT",
      Make: "cf:Manufacturer:TEXT",
      Model: "assetModel",
      "Purchase Date": "cf:Purchase date:DATE",
      "Purchase Price": "valuation",
      "Assigned To": "custodian",
      Status: "cf:Previous status:OPTION",
      Department: "cf:Department:TEXT",
      Location: "location",
      Description: "description",
    });
  });
});
