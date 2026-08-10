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

  it("caps the number of honored terms as a query-cost guard", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `term${i}`).join(",");
    expect(splitAssetSearchTerms(fifteen)).toHaveLength(10);
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

    // Walk the clause and collect EVERY substring filter — asserting the
    // exact count and per-filter mode means losing case-insensitivity on
    // any single branch fails, unlike a >= floor.
    const containsFilters: Array<Record<string, unknown>> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if ("contains" in record || "string_contains" in record) {
          containsFilters.push(record);
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(branches);

    // title, sequentialId, description, category.name, location.name,
    // tag.name, custodian (name + firstName + lastName), qr id, barcode
    // value, 6 custom-field JSON paths = 17 substring filters.
    expect(containsFilters).toHaveLength(17);
    for (const filter of containsFilters) {
      expect(filter.mode).toBe("insensitive");
      expect(filter.contains ?? filter.string_contains).toBe("tripod");
    }

    // Pin the matched COLUMNS structurally, not via substring presence.
    /* eslint-disable @typescript-eslint/no-explicit-any -- why: intentional
       deep-path probing of a where-clause literal; per-node types add noise
       without safety here. */
    const [
      title,
      sequentialId,
      description,
      category,
      location,
      tags,
      custody,
      qrCodes,
      barcodes,
      customFields,
    ] = branches as Array<any>;
    expect(title.title.contains).toBe("tripod");
    expect(sequentialId.sequentialId.contains).toBe("tripod");
    expect(description.description.contains).toBe("tripod");
    expect(category.category.name.contains).toBe("tripod");
    expect(location.assetLocations.some.location.name.contains).toBe("tripod");
    expect(tags.tags.some.name.contains).toBe("tripod");
    const custodianOr = custody.custody.some.custodian.OR;
    expect(custodianOr[0].name.contains).toBe("tripod");
    expect(custodianOr[1].user.OR[0].firstName.contains).toBe("tripod");
    expect(custodianOr[1].user.OR[1].lastName.contains).toBe("tripod");
    expect(qrCodes.qrCodes.some.id.contains).toBe("tripod");
    expect(barcodes.barcodes.some.value.contains).toBe("tripod");
    expect(customFields.customFields.some.OR).toHaveLength(6);
    /* eslint-enable @typescript-eslint/no-explicit-any */
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
