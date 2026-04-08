/**
 * @file Tests for the pure diff computation logic in import-update-diff.ts.
 * All functions tested here are pure (no database calls) and don't require mocking.
 *
 * @see {@link file://./import-update-diff.ts}
 */
import { describe, expect, it } from "vitest";
import {
  analyzeUpdateHeaders,
  compareCoreField,
  compareCustomField,
  computeAssetDiffs,
  normalizeExportedCurrencyValue,
  parseYesNo,
} from "./import-update-diff";
import type { AssetForUpdate, HeaderAnalysis } from "./import-update-types";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal AssetForUpdate for testing field comparisons */
function makeAsset(overrides: Partial<AssetForUpdate> = {}): AssetForUpdate {
  return {
    id: "uuid-1",
    title: "Test Asset",
    sequentialId: "SAM-0001",
    valuation: null,
    availableToBook: true,
    category: null,
    location: null,
    tags: [],
    customFields: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeExportedCurrencyValue
// ---------------------------------------------------------------------------

describe("normalizeExportedCurrencyValue", () => {
  it("strips USD currency symbol and thousand separator", () => {
    expect(normalizeExportedCurrencyValue("$1,234.56")).toBe("1234.56");
  });

  it("handles European format (dot thousands, comma decimal)", () => {
    expect(normalizeExportedCurrencyValue("1.234,56")).toBe("1234.56");
  });

  it("handles European short decimal", () => {
    expect(normalizeExportedCurrencyValue("5454,5")).toBe("5454.5");
  });

  it("passes through plain numbers", () => {
    expect(normalizeExportedCurrencyValue("42.5")).toBe("42.5");
    expect(normalizeExportedCurrencyValue("100")).toBe("100");
  });

  it("strips various currency symbols", () => {
    expect(normalizeExportedCurrencyValue("€100")).toBe("100");
    expect(normalizeExportedCurrencyValue("£50.25")).toBe("50.25");
    expect(normalizeExportedCurrencyValue("¥1000")).toBe("1000");
    expect(normalizeExportedCurrencyValue("₹500")).toBe("500");
  });

  it("handles empty and whitespace strings", () => {
    expect(normalizeExportedCurrencyValue("")).toBe("");
    expect(normalizeExportedCurrencyValue("  ")).toBe("");
  });

  it("treats ambiguous 3-digit-after-comma as US thousand", () => {
    // "1,234" is ambiguous but our export uses US format
    expect(normalizeExportedCurrencyValue("1,234")).toBe("1234");
  });

  it("handles negative numbers", () => {
    expect(normalizeExportedCurrencyValue("-42.5")).toBe("-42.5");
  });

  it("handles value with only currency symbol", () => {
    expect(normalizeExportedCurrencyValue("$")).toBe("");
  });

  it("handles multiple thousand separators", () => {
    expect(normalizeExportedCurrencyValue("1,234,567.89")).toBe("1234567.89");
  });
});

// ---------------------------------------------------------------------------
// parseYesNo
// ---------------------------------------------------------------------------

describe("parseYesNo", () => {
  it('returns true for "yes" (case-insensitive)', () => {
    expect(parseYesNo("yes")).toBe(true);
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("YES")).toBe(true);
  });

  it('returns false for "no" (case-insensitive)', () => {
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("No")).toBe(false);
    expect(parseYesNo("NO")).toBe(false);
  });

  it("trims whitespace before matching", () => {
    expect(parseYesNo(" yes ")).toBe(true);
    expect(parseYesNo("  no  ")).toBe(false);
  });

  it("returns undefined for unrecognized values", () => {
    expect(parseYesNo("")).toBe(undefined);
    expect(parseYesNo("maybe")).toBe(undefined);
    expect(parseYesNo("true")).toBe(undefined);
    expect(parseYesNo("1")).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// analyzeUpdateHeaders
// ---------------------------------------------------------------------------

describe("analyzeUpdateHeaders", () => {
  const mockCustomFields = [
    { id: "cf1", name: "Serial Number", type: "TEXT" as const },
    { id: "cf2", name: "Purchase Date", type: "DATE" as const },
    { id: "cf3", name: "Notes", type: "MULTILINE_TEXT" as const },
  ];

  it("identifies Asset ID as primary identifier", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "Name", "Category"],
      mockCustomFields
    );
    expect(result.idColumnIndex).toBe(0);
    expect(result.idDbField).toBe("sequentialId");
    expect(result.idColumnHeader).toBe("Asset ID");
    expect(result.fallbackId).toBeNull();
  });

  it("identifies ID (UUID) as primary when Asset ID is absent", () => {
    const result = analyzeUpdateHeaders(
      ["ID", "Name", "Category"],
      mockCustomFields
    );
    expect(result.idColumnIndex).toBe(0);
    expect(result.idDbField).toBe("id");
    expect(result.idColumnHeader).toBe("ID");
  });

  it("uses Asset ID as primary and ID as fallback when both present", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "ID", "Name"],
      mockCustomFields
    );
    expect(result.idColumnIndex).toBe(0);
    expect(result.idDbField).toBe("sequentialId");
    expect(result.fallbackId).toEqual({
      index: 1,
      dbField: "id",
      header: "ID",
    });
  });

  it("returns idColumnIndex -1 when no identifier column found", () => {
    const result = analyzeUpdateHeaders(["Name", "Category"], mockCustomFields);
    expect(result.idColumnIndex).toBe(-1);
  });

  it("classifies updatable core fields", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "Name", "Category", "Location", "Tags", "Value"],
      mockCustomFields
    );
    const updatableKeys = result.updatableColumns.map((c) => c.internalKey);
    expect(updatableKeys).toContain("name");
    expect(updatableKeys).toContain("category");
    expect(updatableKeys).toContain("location");
    expect(updatableKeys).toContain("tags");
    expect(updatableKeys).toContain("valuation");
  });

  it("classifies non-updatable fields as ignored", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "Name", "Status", "Kit", "Custody"],
      mockCustomFields
    );
    expect(result.ignoredColumns).toContain("Status");
    expect(result.ignoredColumns).toContain("Kit");
    expect(result.ignoredColumns).toContain("Custody");
  });

  it("matches custom fields by name (case-insensitive)", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "serial number"],
      mockCustomFields
    );
    expect(result.updatableColumns).toHaveLength(1);
    expect(result.updatableColumns[0].kind).toBe("customField");
    expect(result.updatableColumns[0].internalKey).toBe("cf:Serial Number");
  });

  it("ignores unsupported custom field types (MULTILINE_TEXT)", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "Notes"],
      mockCustomFields
    );
    expect(result.updatableColumns).toHaveLength(0);
    expect(result.ignoredColumns).toContain(
      "Notes (multiline_text fields not supported for update)"
    );
  });

  it("puts unknown columns in unrecognizedColumns", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "FooBar", "BazQux"],
      mockCustomFields
    );
    expect(result.unrecognizedColumns).toEqual(["FooBar", "BazQux"]);
  });

  it("builds columnIndexMap for updatable columns", () => {
    const result = analyzeUpdateHeaders(
      ["Asset ID", "Name", "Category"],
      mockCustomFields
    );
    expect(result.columnIndexMap.size).toBe(2);
    expect(result.columnIndexMap.get(1)?.internalKey).toBe("name");
    expect(result.columnIndexMap.get(2)?.internalKey).toBe("category");
  });

  it("trims header whitespace", () => {
    const result = analyzeUpdateHeaders(
      ["  Asset ID  ", "  Name  "],
      mockCustomFields
    );
    expect(result.idColumnIndex).toBe(0);
    expect(result.updatableColumns[0].internalKey).toBe("name");
  });
});

// ---------------------------------------------------------------------------
// compareCoreField
// ---------------------------------------------------------------------------

describe("compareCoreField", () => {
  describe("name", () => {
    it("detects name change", () => {
      const asset = makeAsset({ title: "Old Name" });
      const result = compareCoreField("name", "New Name", asset, "Name");
      expect(result).toEqual({
        field: "Name",
        currentValue: "Old Name",
        newValue: "New Name",
      });
    });

    it("returns null when name unchanged", () => {
      const asset = makeAsset({ title: "Same Name" });
      expect(compareCoreField("name", "Same Name", asset, "Name")).toBeNull();
    });
  });

  describe("category", () => {
    it("detects category change (case-insensitive)", () => {
      const asset = makeAsset({ category: { name: "Electronics" } });
      const result = compareCoreField(
        "category",
        "Furniture",
        asset,
        "Category"
      );
      expect(result?.newValue).toBe("Furniture");
    });

    it("returns null for same category different case", () => {
      const asset = makeAsset({ category: { name: "Electronics" } });
      expect(
        compareCoreField("category", "electronics", asset, "Category")
      ).toBeNull();
    });

    it('uses "Uncategorized" as default when asset has no category', () => {
      const asset = makeAsset({ category: null });
      expect(
        compareCoreField("category", "Uncategorized", asset, "Category")
      ).toBeNull();
    });
  });

  describe("location", () => {
    it("detects location change", () => {
      const asset = makeAsset({
        location: { id: "loc-1", name: "Office A" },
      });
      const result = compareCoreField(
        "location",
        "Warehouse",
        asset,
        "Location"
      );
      expect(result?.newValue).toBe("Warehouse");
      expect(result?.currentValue).toBe("Office A");
    });

    it('shows "(none)" for null location', () => {
      const asset = makeAsset({ location: null });
      const result = compareCoreField("location", "Office", asset, "Location");
      expect(result?.currentValue).toBe("(none)");
    });
  });

  describe("tags", () => {
    it("detects tag additions", () => {
      const asset = makeAsset({ tags: [{ id: "t1", name: "TagA" }] });
      const result = compareCoreField("tags", "TagA, TagB", asset, "Tags");
      expect(result).not.toBeNull();
      expect(result?.newValue).toBe("TagA, TagB");
    });

    it("ignores tag reordering (case-insensitive)", () => {
      const asset = makeAsset({
        tags: [
          { id: "t1", name: "Alpha" },
          { id: "t2", name: "Beta" },
        ],
      });
      expect(compareCoreField("tags", "beta, alpha", asset, "Tags")).toBeNull();
    });

    it('shows "(none)" when asset has no tags', () => {
      const asset = makeAsset({ tags: [] });
      const result = compareCoreField("tags", "NewTag", asset, "Tags");
      expect(result?.currentValue).toBe("(none)");
    });
  });

  describe("valuation", () => {
    it("detects valuation change with currency normalization", () => {
      const asset = makeAsset({ valuation: 100 });
      const result = compareCoreField("valuation", "$200", asset, "Valuation");
      expect(result?.newValue).toBe("200");
    });

    it("returns warning for invalid number", () => {
      const asset = makeAsset({ valuation: 100 });
      const result = compareCoreField("valuation", "abc", asset, "Valuation");
      expect(result?.warning).toContain("not a valid number");
    });

    it("distinguishes null valuation from 0", () => {
      const asset = makeAsset({ valuation: null });
      const result = compareCoreField("valuation", "0", asset, "Valuation");
      expect(result).not.toBeNull();
      expect(result?.currentValue).toBe("(none)");
      expect(result?.newValue).toBe("0");
    });

    it("ignores changes within epsilon threshold", () => {
      const asset = makeAsset({ valuation: 100 });
      expect(
        compareCoreField("valuation", "100.0001", asset, "Valuation")
      ).toBeNull();
    });
  });

  describe("availableToBook", () => {
    it("detects change from Yes to No", () => {
      const asset = makeAsset({ availableToBook: true });
      const result = compareCoreField(
        "availableToBook",
        "No",
        asset,
        "Available to book"
      );
      expect(result?.newValue).toBe("No");
    });

    it("returns warning for invalid boolean value", () => {
      const asset = makeAsset({ availableToBook: true });
      const result = compareCoreField(
        "availableToBook",
        "Maybe",
        asset,
        "Available to book"
      );
      expect(result?.warning).toContain("expected");
    });

    it("returns null when value unchanged", () => {
      const asset = makeAsset({ availableToBook: true });
      expect(
        compareCoreField("availableToBook", "Yes", asset, "Available to book")
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// compareCustomField
// ---------------------------------------------------------------------------

describe("compareCustomField", () => {
  const textCfDef = {
    name: "Serial",
    type: "TEXT" as const,
    helpText: "",
    required: false,
    active: true,
  };

  const boolCfDef = {
    name: "Active",
    type: "BOOLEAN" as const,
    helpText: "",
    required: false,
    active: true,
  };

  const dateCfDef = {
    name: "PurchaseDate",
    type: "DATE" as const,
    helpText: "",
    required: false,
    active: true,
  };

  const numberCfDef = {
    name: "Weight",
    type: "NUMBER" as const,
    helpText: "",
    required: false,
    active: true,
  };

  describe("TEXT", () => {
    it("detects text change", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "OLD-123" },
            customField: { name: "Serial" } as any,
          },
        ],
      });
      const result = compareCustomField(textCfDef, "NEW-456", asset, "Serial");
      expect(result?.newValue).toBe("NEW-456");
    });

    it("returns null when text unchanged", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "SAME" },
            customField: { name: "Serial" } as any,
          },
        ],
      });
      expect(compareCustomField(textCfDef, "SAME", asset, "Serial")).toBeNull();
    });
  });

  describe("BOOLEAN", () => {
    it("detects boolean change", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "yes", valueBoolean: true },
            customField: { name: "Active" } as any,
          },
        ],
      });
      const result = compareCustomField(boolCfDef, "No", asset, "Active");
      expect(result?.newValue).toBe("No");
    });

    it("returns warning for unrecognized boolean", () => {
      const asset = makeAsset();
      const result = compareCustomField(boolCfDef, "Maybe", asset, "Active");
      expect(result?.warning).toContain("expected");
    });

    it("detects change from empty to boolean", () => {
      const asset = makeAsset({ customFields: [] });
      const result = compareCustomField(boolCfDef, "No", asset, "Active");
      expect(result?.currentValue).toBe("(empty)");
      expect(result?.newValue).toBe("No");
    });
  });

  describe("DATE", () => {
    it("detects valid date change", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "2024-01-15" },
            customField: { name: "PurchaseDate" } as any,
          },
        ],
      });
      const result = compareCustomField(
        dateCfDef,
        "2024-06-23",
        asset,
        "Purchase Date"
      );
      expect(result?.newValue).toBe("2024-06-23");
      expect(result?.warning).toBeUndefined();
    });

    it("returns warning for invalid date format", () => {
      const asset = makeAsset();
      const result = compareCustomField(
        dateCfDef,
        "23 June 2024",
        asset,
        "Purchase Date"
      );
      expect(result?.warning).toContain("Invalid date format");
    });

    it("returns warning for impossible date (Feb 31)", () => {
      const asset = makeAsset();
      const result = compareCustomField(
        dateCfDef,
        "2024-02-31",
        asset,
        "Purchase Date"
      );
      expect(result?.warning).toContain("Invalid date format");
    });
  });

  describe("NUMBER", () => {
    it("detects number change with currency normalization", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "50" },
            customField: { name: "Weight" } as any,
          },
        ],
      });
      const result = compareCustomField(numberCfDef, "$100", asset, "Weight");
      expect(result?.newValue).toBe("100");
    });

    it("returns warning for non-numeric value", () => {
      const asset = makeAsset();
      const result = compareCustomField(numberCfDef, "abc", asset, "Weight");
      expect(result?.warning).toContain("not a valid number");
    });

    it("ignores change within epsilon", () => {
      const asset = makeAsset({
        customFields: [
          {
            id: "cfv1",
            value: { raw: "100" },
            customField: { name: "Weight" } as any,
          },
        ],
      });
      expect(
        compareCustomField(numberCfDef, "100.0001", asset, "Weight")
      ).toBeNull();
    });

    it("detects change from empty to number", () => {
      const asset = makeAsset({ customFields: [] });
      const result = compareCustomField(numberCfDef, "42", asset, "Weight");
      expect(result?.currentValue).toBe("(empty)");
      expect(result?.newValue).toBe("42");
    });
  });
});

// ---------------------------------------------------------------------------
// computeAssetDiffs
// ---------------------------------------------------------------------------

describe("computeAssetDiffs", () => {
  /** Builds a minimal HeaderAnalysis for testing */
  function makeHeaderAnalysis(
    overrides: Partial<HeaderAnalysis> = {}
  ): HeaderAnalysis {
    const columnIndexMap = new Map<number, any>();
    columnIndexMap.set(1, {
      csvHeader: "Name",
      internalKey: "name",
      kind: "core",
      csvIndex: 1,
    });

    return {
      updatableColumns: [
        {
          csvHeader: "Name",
          internalKey: "name",
          kind: "core" as const,
          csvIndex: 1,
        },
      ],
      ignoredColumns: [],
      unrecognizedColumns: [],
      idColumnIndex: 0,
      idDbField: "sequentialId" as const,
      idColumnHeader: "Asset ID",
      fallbackId: null,
      columnIndexMap,
      ...overrides,
    };
  }

  it("detects changes between CSV and existing assets", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ title: "Old Name" }));

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", "New Name"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    expect(result.assetsToUpdate).toHaveLength(1);
    expect(result.assetsToUpdate[0].changes[0].newValue).toBe("New Name");
  });

  it("skips assets with no changes", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ title: "Same Name" }));

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", "Same Name"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    expect(result.assetsToUpdate).toHaveLength(0);
    expect(result.skippedAssets).toHaveLength(1);
    expect(result.skippedAssets[0].reason).toBe("No changes detected");
  });

  it("reports missing assets as failed rows", () => {
    const assets = new Map<string, AssetForUpdate>();

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-9999", "Some Name"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].reason).toBe(
      "Asset not found in your organization"
    );
  });

  it("detects duplicate rows by canonical UUID", () => {
    const asset = makeAsset({ id: "uuid-1" });
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", asset);
    assets.set("SAM-0002", asset); // same UUID, different sequential ID

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", "Change 1"],
      ["SAM-0002", "Change 2"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    expect(result.assetsToUpdate).toHaveLength(1);
    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].reason).toContain("Duplicate ID");
  });

  it("treats empty cells as no change", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ title: "Keep This" }));

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", ""],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    expect(result.assetsToUpdate).toHaveLength(0);
    expect(result.skippedAssets).toHaveLength(1);
  });

  it("reports rows with missing asset ID", () => {
    const csvData = [
      ["Asset ID", "Name"],
      ["", "Some Name"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: new Map(),
    });

    expect(result.failedRows).toHaveLength(1);
    expect(result.failedRows[0].reason).toBe("Missing asset ID");
  });

  it("uses fallback identifier when primary is blank", () => {
    const asset = makeAsset({ id: "uuid-1", title: "Old Name" });
    const primaryAssets = new Map<string, AssetForUpdate>();
    const fallbackAssets = new Map<string, AssetForUpdate>();
    fallbackAssets.set("uuid-1", asset);

    const columnIndexMap = new Map<number, any>();
    columnIndexMap.set(2, {
      csvHeader: "Name",
      internalKey: "name",
      kind: "core",
      csvIndex: 2,
    });

    const headerAnalysis = makeHeaderAnalysis({
      fallbackId: { index: 1, dbField: "id", header: "ID" },
      columnIndexMap,
      updatableColumns: [
        {
          csvHeader: "Name",
          internalKey: "name",
          kind: "core" as const,
          csvIndex: 2,
        },
      ],
    });

    const csvData = [
      ["Asset ID", "ID", "Name"],
      ["", "uuid-1", "New Name"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis,
      existingAssets: primaryAssets,
      fallbackAssets,
    });

    expect(result.assetsToUpdate).toHaveLength(1);
    expect(result.assetsToUpdate[0].changes[0].newValue).toBe("New Name");
  });

  it("returns correct totalRows count", () => {
    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", "A"],
      ["SAM-0002", "B"],
      ["SAM-0003", "C"],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: new Map(),
    });

    expect(result.totalRows).toBe(3);
  });

  it("detects clearing when empty cell has existing value (category)", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ category: { name: "Electronics" } }));

    const columnIndexMap = new Map<number, any>();
    columnIndexMap.set(1, {
      csvHeader: "Category",
      internalKey: "category",
      kind: "core",
      csvIndex: 1,
    });

    const headerAnalysis = makeHeaderAnalysis({
      columnIndexMap,
      updatableColumns: [
        {
          csvHeader: "Category",
          internalKey: "category",
          kind: "core" as const,
          csvIndex: 1,
        },
      ],
    });

    const csvData = [
      ["Asset ID", "Category"],
      ["SAM-0001", ""],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis,
      existingAssets: assets,
    });

    expect(result.assetsToUpdate).toHaveLength(1);
    expect(result.assetsToUpdate[0].changes[0].clearing).toBe(true);
    expect(result.assetsToUpdate[0].changes[0].currentValue).toBe(
      "Electronics"
    );
  });

  it("does not clear when field is already empty", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ category: null }));

    const columnIndexMap = new Map<number, any>();
    columnIndexMap.set(1, {
      csvHeader: "Category",
      internalKey: "category",
      kind: "core",
      csvIndex: 1,
    });

    const headerAnalysis = makeHeaderAnalysis({
      columnIndexMap,
      updatableColumns: [
        {
          csvHeader: "Category",
          internalKey: "category",
          kind: "core" as const,
          csvIndex: 1,
        },
      ],
    });

    const csvData = [
      ["Asset ID", "Category"],
      ["SAM-0001", ""],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis,
      existingAssets: assets,
    });

    // Empty→empty = no change
    expect(result.assetsToUpdate).toHaveLength(0);
    expect(result.skippedAssets).toHaveLength(1);
  });

  it("does not clear exempt fields (name)", () => {
    const assets = new Map<string, AssetForUpdate>();
    assets.set("SAM-0001", makeAsset({ title: "Some Asset" }));

    const csvData = [
      ["Asset ID", "Name"],
      ["SAM-0001", ""],
    ];

    const result = computeAssetDiffs({
      csvData,
      headerAnalysis: makeHeaderAnalysis(),
      existingAssets: assets,
    });

    // Name is exempt from clearing
    expect(result.assetsToUpdate).toHaveLength(0);
    expect(result.skippedAssets).toHaveLength(1);
  });
});
