/**
 * @file Regression coverage for the bulk-update client-side CSV validation
 * helpers. Focused on the identifier-column detection in
 * `validateCsvClientSide`, which gates whether the "Analyze file" button is
 * enabled (see `form.tsx`'s `canAnalyze`).
 *
 * @see {@link file://./helpers.ts}
 */
import { describe, expect, it } from "vitest";
import { validateCsvClientSide } from "./helpers";

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
