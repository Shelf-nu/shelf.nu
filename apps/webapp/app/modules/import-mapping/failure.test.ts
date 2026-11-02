import { describe, expect, it } from "vitest";
import { classifyImportFailure } from "./failure";

describe("classifyImportFailure", () => {
  it("trusts a tagged reason from the list", () => {
    expect(
      classifyImportFailure({ additionalData: { failureReason: "empty_file" } })
    ).toBe("empty_file");
  });

  it("ignores a tag outside the list", () => {
    expect(
      classifyImportFailure({ additionalData: { failureReason: "nope" } })
    ).toBe("other");
  });

  it.each([
    [{ defectedHeaders: [] }, "invalid_headers"],
    [{ rowErrors: [] }, "row_errors"],
    [{ linkedCodes: [] }, "qr_codes"],
    [{ duplicateBarcodes: [] }, "barcodes"],
    [{ kitCustodyConflicts: [] }, "kit_custody"],
  ])(
    "recognises importer errors by their data: %o",
    (additionalData, reason) => {
      expect(classifyImportFailure({ additionalData })).toBe(reason);
    }
  );

  it("reads a 403 as missing barcode add-on and CSV errors as unreadable", () => {
    expect(classifyImportFailure({ status: 403 })).toBe("barcodes_not_enabled");
    expect(classifyImportFailure({ label: "CSV" })).toBe("unreadable_file");
    expect(classifyImportFailure({})).toBe("other");
  });
});
