/**
 * @file Regression coverage for the bulk-update client-side CSV validation
 * helpers. Focused on the identifier-column detection in
 * `validateCsvClientSide`, which gates whether the "Analyze file" button is
 * enabled (see `form.tsx`'s `canAnalyze`).
 *
 * @see {@link file://./helpers.ts}
 */
import { describe, expect, it } from "vitest";
import {
  formatUnrecognizedColumnLabel,
  splitCsvRecords,
  validateCsvClientSide,
} from "./helpers";

describe("validateCsvClientSide — identifier column detection", () => {
  it("recognizes the Standard export's 'Asset ID' header", () => {
    const csv = "Asset ID,Name\nSAM-0001,Test Asset\n";
    const result = validateCsvClientSide(csv);
    expect(result.idColumnFound).toBe("Asset ID");
    expect(result.valid).toBe(true);
  });

  it("recognizes the lowercase 'id' header from the Import-ready export (Task 3 fix)", () => {
    // why: the Import-ready export always emits a lowercase "id" column
    // (content-importer vocabulary) as of the sibling id-column task. Before
    // this fix, ACCEPTED_ID_COLUMNS matched case-sensitively against "ID"
    // only, so re-uploading that export showed "No identifier column found"
    // and left the "Analyze file" button disabled even though the server
    // would have accepted the file.
    const csv = "id,title,category\nabc-123,Test Asset,Electronics\n";
    const result = validateCsvClientSide(csv);
    expect(result.idColumnFound).toBe("ID");
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("still reports no identifier column when none is present", () => {
    const csv = "Name,Category\nTest Asset,Electronics\n";
    const result = validateCsvClientSide(csv);
    expect(result.idColumnFound).toBeNull();
    expect(result.valid).toBe(false);
    expect(result.warnings).toContain(
      "No identifier column found. Your CSV needs an Asset ID or ID column to match rows to existing assets."
    );
  });
});

describe("formatUnrecognizedColumnLabel (final review fix)", () => {
  // why: a `cf:<Name>,type:<TYPE>` header naming a field absent from the
  // workspace lands in `unrecognizedColumns` (see analyzeUpdateHeaders).
  // Rendering it raw made the "create a matching Custom Field" advice
  // point at creating a field literally named `cf:Serial,type:TEXT`.
  it("parses a cf: header down to just the field name", () => {
    expect(formatUnrecognizedColumnLabel("cf:Serial,type:TEXT")).toBe("Serial");
    expect(formatUnrecognizedColumnLabel("cf:Purchase Date,type:DATE")).toBe(
      "Purchase Date"
    );
  });

  it("leaves a plain (non cf:) header unchanged", () => {
    expect(formatUnrecognizedColumnLabel("Some Random Column")).toBe(
      "Some Random Column"
    );
  });

  it("leaves a malformed short 'cf:' header unchanged (guards the non-null assertion)", () => {
    expect(formatUnrecognizedColumnLabel("cf:")).toBe("cf:");
  });
});

describe("splitCsvRecords — quoted fields carrying line breaks", () => {
  /**
   * A description typed with paragraph breaks, as the Import-ready export
   * writes it: quoted, CRLF inside the field, CRLF between records.
   */
  const MULTILINE_CSV =
    '"id","title","description"\r\n' +
    '"a1","Tecles de cadena","Tecles de cadena\r\nMarca EMTOP\r\nSon 2 iguales"\r\n' +
    '"a2","Mazos","MAZO DE IMPACTO\r\n2 UNDS"\r\n';

  it("counts a field's line breaks as part of its record", () => {
    expect(splitCsvRecords(MULTILINE_CSV).records).toHaveLength(3);
  });

  it("keeps the quotes so the record still splits on its delimiters", () => {
    const [, first] = splitCsvRecords(MULTILINE_CSV).records;
    expect(first.startsWith('"a1"')).toBe(true);
  });

  it("treats a doubled quote as an escaped quote, not a boundary", () => {
    const csv = '"id","note"\n"a1","he said ""hi""\nthen left"\n';
    expect(splitCsvRecords(csv).records).toHaveLength(2);
  });

  it("handles LF-only and CRLF line endings alike", () => {
    expect(splitCsvRecords("a,b\nc,d\n").records).toHaveLength(2);
    expect(splitCsvRecords("a,b\r\nc,d\r\n").records).toHaveLength(2);
  });

  it("drops blank records", () => {
    expect(splitCsvRecords("a,b\n\n\nc,d\n").records).toHaveLength(2);
  });

  it("reports a well-formed document as balanced", () => {
    expect(splitCsvRecords(MULTILINE_CSV).unterminatedQuote).toBe(false);
  });

  it("reports a stray quote that is never closed", () => {
    // An inches mark typed straight into a cell is the everyday source: the
    // quote opens a field that never ends, so every later row is absorbed.
    const csv = 'id,title\n1,24" Monitor\n2,Laptop\n';
    const { records, unterminatedQuote } = splitCsvRecords(csv);

    expect(unterminatedQuote).toBe(true);
    expect(records).toHaveLength(2);
  });
});

describe("validateCsvClientSide — unbalanced quotes", () => {
  it("names the stray quote instead of reporting the symptom", () => {
    // The server rejects this file too ("Invalid Opening Quote"), so blocking
    // here is not a false stop — it just has to say what is actually wrong,
    // rather than "no data rows" about a file full of visible rows.
    const result = validateCsvClientSide('id,tit"le\n1,Laptop\n2,Monitor\n');

    expect(result.valid).toBe(false);
    expect(result.warnings).toContain(
      'Unbalanced quote: a " is opened and never closed, so the rows after it run together. Write a literal quote as two ("").'
    );
    expect(result.warnings).not.toContain(
      "No data rows found — only a header row."
    );
  });

  it("blocks a stray quote in a data row as well", () => {
    const result = validateCsvClientSide('id,title\n1,24" Monitor\n2,Laptop\n');

    expect(result.valid).toBe(false);
  });
});

describe("validateCsvClientSide — row count with multi-line descriptions", () => {
  it("reports assets, not lines", () => {
    // Two assets whose descriptions span three and two lines respectively.
    const csv =
      '"id","title","description"\r\n' +
      '"a1","Tecles","Tecles de cadena\r\nMarca EMTOP\r\nSon 2 iguales"\r\n' +
      '"a2","Mazos","MAZO DE IMPACTO\r\n2 UNDS"\r\n';

    const result = validateCsvClientSide(csv);

    expect(result.rowCount).toBe(2);
    expect(result.headerCount).toBe(3);
    expect(result.idColumnFound).toBe("ID");
    expect(result.valid).toBe(true);
  });
});
