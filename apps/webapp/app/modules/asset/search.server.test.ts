/**
 * Test suite for the shared simple-mode asset search clause builders.
 *
 * These builders are consumed by BOTH the web `getAssets` fetcher and the
 * mobile assets endpoint, so this suite pins the searchable field set — a
 * field silently dropped here would degrade search on every surface at once.
 * Pure module — no mocks needed.
 *
 * @see {@link file://./search.server.ts}
 */
import {
  buildFullAssetSearchOr,
  buildNarrowAssetSearchOr,
  looksLikeAssetId,
  splitAssetSearchTerms,
} from "./search.server";

// @vitest-environment node

describe("splitAssetSearchTerms", () => {
  it("lowercases, trims, splits on commas and drops empties", () => {
    expect(splitAssetSearchTerms("  Tripod, Canon EOS ,,")).toEqual([
      "tripod",
      "canon eos",
    ]);
  });

  it("returns an empty array for empty and whitespace-only input", () => {
    expect(splitAssetSearchTerms("")).toEqual([]);
    expect(splitAssetSearchTerms("   ")).toEqual([]);
    expect(splitAssetSearchTerms(" , , ")).toEqual([]);
  });
});

describe("looksLikeAssetId", () => {
  it("matches bare numerics and canonical sequential ids", () => {
    expect(looksLikeAssetId("21035")).toBe(true);
    expect(looksLikeAssetId("123456789012")).toBe(true);
    expect(looksLikeAssetId("sam-0001")).toBe(true);
    expect(looksLikeAssetId("SAM-0001")).toBe(true);
  });

  it("rejects loose word-like terms", () => {
    expect(looksLikeAssetId("lab-12")).toBe(false); // fewer than 4 digits
    expect(looksLikeAssetId("AS1000")).toBe(false); // no dash
    expect(looksLikeAssetId("tripod")).toBe(false);
    expect(looksLikeAssetId("sam-0001x")).toBe(false);
  });
});

describe("buildFullAssetSearchOr", () => {
  it("builds one OR-group per term", () => {
    expect(buildFullAssetSearchOr(["a", "b"])).toHaveLength(2);
  });

  it("covers every searchable field, case-insensitively", () => {
    const [group] = buildFullAssetSearchOr(["tripod"]);
    const branches = group.OR ?? [];

    // 10 branches: title, sequentialId, description, category, location,
    // tags, custodian names, QR id, barcode value, custom fields.
    expect(branches).toHaveLength(10);

    const serialized = JSON.stringify(branches);
    for (const fieldPath of [
      '"title"',
      '"sequentialId"',
      '"description"',
      '"category"',
      '"assetLocations"',
      '"tags"',
      '"custody"',
      '"firstName"',
      '"lastName"',
      '"qrCodes"',
      '"barcodes"',
      '"customFields"',
    ]) {
      expect(serialized).toContain(fieldPath);
    }

    // Every contains-filter is case-insensitive.
    const modes = serialized.match(/"mode":"insensitive"/g) ?? [];
    expect(modes.length).toBeGreaterThanOrEqual(10);
  });

  it("searches every custom-field value shape", () => {
    const [group] = buildFullAssetSearchOr(["x"]);
    const serialized = JSON.stringify(group);
    for (const jsonPath of [
      "valueText",
      "valueMultiLineText",
      "valueOption",
      "valueDate",
      "valueBoolean",
      "raw",
    ]) {
      expect(serialized).toContain(jsonPath);
    }
  });
});

describe("buildNarrowAssetSearchOr", () => {
  it("builds a flat 5-branch clause per term over the indexed columns", () => {
    const clauses = buildNarrowAssetSearchOr(["sam-0001", "21035"]);
    expect(clauses).toHaveLength(10);

    const serialized = JSON.stringify(clauses);
    for (const fieldPath of [
      '"sequentialId"',
      '"barcodes"',
      '"qrCodes"',
      '"title"',
      '"description"',
    ]) {
      expect(serialized).toContain(fieldPath);
    }
    // The slow paths must NOT be in the narrow clause.
    for (const heavy of ['"custody"', '"customFields"', '"tags"']) {
      expect(serialized).not.toContain(heavy);
    }
  });
});
