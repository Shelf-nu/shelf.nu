/**
 * Unit tests for buildAssetSearchUnion — the shared org-scoped UNION of
 * matching asset ids used by both the advanced and simple asset indexes.
 *
 * The webapp vitest harness has no real DB, so these assert the generated SQL
 * STRING and bound params (the @map-column guard from
 * .claude/rules/raw-sql-respects-prisma-map.md), not row-level results.
 * Row-level parity (UNION id-set == the old Prisma OR clause's id-set) is
 * verified out-of-harness against a staging copy of a large org, plus the
 * post-deploy EXPLAIN ANALYZE — see the PR's verification notes.
 */
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildAssetSearchUnion,
  CUSTOM_FIELD_SEARCH_PATHS,
} from "./search-union.server";

/** Flatten a Prisma.Sql into its literal SQL text (params become `?`). */
function sqlText(sql: Prisma.Sql): string {
  return sql.strings.join("?");
}

describe("buildAssetSearchUnion", () => {
  const orgId = "org_123";

  it("scopes every branch to the organization and covers all 10 sources", () => {
    const text = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["chair"] })
    );

    // org-scoped (literal param) in the leading Asset branch
    expect(text).toContain('"organizationId"');
    // one UNION-ed branch per source table (mapped column names)
    expect(text).toContain('a."title"');
    expect(text).toContain('a."sequentialId"');
    expect(text).toContain('a."description"');
    expect(text).toContain('"Category"');
    expect(text).toContain('"AssetLocation"');
    expect(text).toContain('"_AssetToTag"');
    expect(text).toContain('"Custody"');
    expect(text).toContain('"TeamMember"');
    expect(text).toContain('"Qr"');
    expect(text).toContain('"Barcode"');
    expect(text).toContain('"AssetCustomFieldValue"');
    // UNION structure present
    expect(text).toContain("UNION");
  });

  it("org-scopes the asset directly in every branch (no cross-org pivot leak)", () => {
    const text = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["chair"] })
    );
    // The 3 pivot-based branches join back to Asset and pin a."organizationId",
    // so the helper is safe to run standalone (not only under an outer org filter).
    expect(text).toContain('JOIN public."Asset" a ON a."id" = al."assetId"'); // Location
    expect(text).toContain('JOIN public."Asset" a ON a."id" = att."A"'); // Tag
    expect(text).toContain('JOIN public."Asset" a ON a."id" = cu."assetId"'); // Custody
  });

  it("uses @map DB column names, not Prisma field names", () => {
    const text = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["x"] })
    );
    expect(text).toContain('b."value"'); // Barcode.value (not "barcode")
    expect(text).toContain('q."id"'); // Qr.id
    // Custodian names: `User.displayName` carries no @map, so the SQL column is
    // the field name verbatim. It sits alongside first/last name because it is
    // what the custody chip renders for users who set one.
    expect(text).toContain('u."firstName"');
    expect(text).toContain('u."lastName"');
    expect(text).toContain('u."displayName"');
    // custom-field jsonb paths
    for (const path of CUSTOM_FIELD_SEARCH_PATHS) {
      expect(text).toContain(`'{${path}}'`);
    }
  });

  it("prefilters the custom-field branch with the indexed COALESCE concat + keeps the exact OR", () => {
    const text = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["chair"] })
    );
    // Indexed prefilter must match AssetCustomFieldValue_searchable_trgm_idx:
    // COALESCE(acfv."value"#>>'{...}', '') || ' ' || COALESCE(...) || ...
    expect(text).toContain(`COALESCE(acfv."value"#>>'{valueText}', '')`);
    expect(text).toContain(`|| ' ' ||`);
    // The exact per-path OR is retained as the correctness filter (parity).
    expect(text).toContain(`acfv."value"#>>'{valueText}' ILIKE`);
  });

  it("binds organizationId and every %term% pattern as parameters", () => {
    const sql = buildAssetSearchUnion({
      organizationId: orgId,
      terms: ["chair", "desk"],
    });
    expect(sql.values).toContain(orgId);
    expect(sql.values).toContain("%chair%");
    expect(sql.values).toContain("%desk%");
  });

  it("repeats the branch group once per term (OR-of-terms via UNION)", () => {
    const one = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["a"] })
    );
    const two = sqlText(
      buildAssetSearchUnion({ organizationId: orgId, terms: ["a", "b"] })
    );
    // twice as many UNION keywords (roughly) — assert the two-term SQL is longer
    // and contains at least as many source-table mentions as the single-term ×2.
    const countBarcode = (s: string) => s.split('"Barcode"').length - 1;
    expect(countBarcode(two)).toBe(countBarcode(one) * 2);
  });

  it("throws on empty terms (caller must guard)", () => {
    expect(() =>
      buildAssetSearchUnion({ organizationId: orgId, terms: [] })
    ).toThrow();
  });
});
