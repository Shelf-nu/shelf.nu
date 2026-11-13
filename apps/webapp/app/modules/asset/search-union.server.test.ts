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
  custodySearchScopeFor,
  CUSTOM_FIELD_SEARCH_PATHS,
} from "./search-union.server";

/** Flatten a Prisma.Sql into its literal SQL text (params become `?`). */
function sqlText(sql: Prisma.Sql): string {
  return sql.strings.join("?");
}

describe("buildAssetSearchUnion", () => {
  const orgId = "org_123";
  /** A viewer who may see everyone's custody. */
  const seeAll = { organizationId: orgId, custodySearchScope: "all" as const };

  it("scopes every branch to the organization and covers all 11 sources", () => {
    const text = sqlText(
      buildAssetSearchUnion({ ...seeAll, terms: ["chair"] })
    );

    // org-scoped (literal param) in the leading Asset branch
    expect(text).toContain('"organizationId"');
    // one UNION-ed branch per source table (mapped column names)
    expect(text).toContain('a."title"');
    expect(text).toContain('a."sequentialId"');
    expect(text).toContain('a."description"');
    expect(text).toContain('"AssetModel"');
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
      buildAssetSearchUnion({ ...seeAll, terms: ["chair"] })
    );
    // The 3 pivot-based branches join back to Asset and pin a."organizationId",
    // so the helper is safe to run standalone (not only under an outer org filter).
    expect(text).toContain('JOIN public."Asset" a ON a."id" = al."assetId"'); // Location
    expect(text).toContain('JOIN public."Asset" a ON a."id" = att."A"'); // Tag
    expect(text).toContain('JOIN public."Asset" a ON a."id" = cu."assetId"'); // Custody
  });

  it("matches an asset by its asset model's name, org-scoped on both sides", () => {
    const text = sqlText(buildAssetSearchUnion({ ...seeAll, terms: ["dell"] }));

    // Reaches Asset through the direct `assetModelId` FK and reads the model's
    // own name column. Without this branch a model-name term matches nothing,
    // and the model view reports every model as holding 0 assets.
    expect(text).toContain('FROM public."AssetModel" am');
    expect(text).toContain(
      'JOIN public."Asset" a ON a."assetModelId" = am."id"'
    );
    expect(text).toContain('am."name" ILIKE');

    // Both predicates live inside this one branch: scoping only the model side
    // leaves the Asset join unbounded across tenants, which is the cross-org
    // sequential scan the UNION shape exists to avoid.
    const fromAssetModel = text.slice(
      text.indexOf('FROM public."AssetModel" am')
    );
    const assetModelBranch = fromAssetModel.slice(
      0,
      fromAssetModel.indexOf("UNION")
    );
    expect(assetModelBranch).toContain('am."organizationId" =');
    expect(assetModelBranch).toContain('a."organizationId" =');
  });

  it("uses @map DB column names, not Prisma field names", () => {
    const text = sqlText(buildAssetSearchUnion({ ...seeAll, terms: ["x"] }));
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
      buildAssetSearchUnion({ ...seeAll, terms: ["chair"] })
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
      ...seeAll,
      terms: ["chair", "desk"],
    });
    expect(sql.values).toContain(orgId);
    expect(sql.values).toContain("%chair%");
    expect(sql.values).toContain("%desk%");
  });

  it("repeats the branch group once per term (OR-of-terms via UNION)", () => {
    const one = sqlText(buildAssetSearchUnion({ ...seeAll, terms: ["a"] }));
    const two = sqlText(
      buildAssetSearchUnion({ ...seeAll, terms: ["a", "b"] })
    );
    // twice as many UNION keywords (roughly) — assert the two-term SQL is longer
    // and contains at least as many source-table mentions as the single-term ×2.
    const countBarcode = (s: string) => s.split('"Barcode"').length - 1;
    expect(countBarcode(two)).toBe(countBarcode(one) * 2);
  });

  describe("custodian-name branch", () => {
    /** The custody branch alone: from its FROM up to the next UNION. */
    function custodyBranch(text: string): string {
      const fromCustody = text.slice(
        text.indexOf('SELECT cu."assetId" FROM public."TeamMember" tm')
      );
      return fromCustody.slice(0, fromCustody.indexOf("UNION"));
    }

    it("matches only the viewer's own custody when they may not see all custody", () => {
      const sql = buildAssetSearchUnion({
        organizationId: orgId,
        terms: ["alice"],
        custodySearchScope: { userId: "viewer-1" },
      });
      // The name match stays, AND-ed with the custodian being the viewer.
      expect(custodyBranch(sqlText(sql))).toContain('u."displayName" ILIKE ?');
      expect(custodyBranch(sqlText(sql))).toContain('AND tm."userId" = ?');
      expect(sql.values).toContain("viewer-1");
    });

    it("scopes the custody branch once per term", () => {
      const text = sqlText(
        buildAssetSearchUnion({
          organizationId: orgId,
          terms: ["alice", "bob"],
          custodySearchScope: { userId: "viewer-1" },
        })
      );
      expect(text.split('AND tm."userId" = ?').length - 1).toBe(2);
    });

    it("leaves the SQL unchanged for a viewer who sees all custody", () => {
      const sql = buildAssetSearchUnion({ ...seeAll, terms: ["alice"] });
      expect(sqlText(sql)).not.toContain('tm."userId" = ?');
      // Same text and the same bound values as before the scope existed: the
      // org id and the pattern only.
      expect(new Set(sql.values)).toEqual(new Set([orgId, "%alice%"]));
    });
  });

  describe("custodySearchScopeFor", () => {
    it("is unrestricted for a viewer who sees all custody", () => {
      expect(
        custodySearchScopeFor({ canSeeAllCustody: true, userId: "u1" })
      ).toBe("all");
    });

    it("is limited to the viewer otherwise", () => {
      expect(
        custodySearchScopeFor({ canSeeAllCustody: false, userId: "u1" })
      ).toEqual({ userId: "u1" });
    });
  });

  it("throws on empty terms (caller must guard)", () => {
    expect(() => buildAssetSearchUnion({ ...seeAll, terms: [] })).toThrow();
  });
});
