import { describe, expect, it, vi } from "vitest";
import { locationDescendantsMock } from "@mocks/location-descendants";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { ShelfError } from "~/utils/error";
import {
  assetQueryFragment,
  assetQueryJoins,
  generateCustomFieldSelect,
  generateWhereClause,
  parseSortingOptions,
} from "./query.server";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

const DEFAULT_FALLBACK_ORDER_BY =
  'ORDER BY "assetCreatedAt" DESC, "assetId" ASC';

describe("parseSortingOptions", () => {
  it("allows sorting by updatedAt", () => {
    const { orderByClause } = parseSortingOptions(["updatedAt:desc"]);

    expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc');
  });

  describe("direction validation", () => {
    it("normalizes uppercase DESC to desc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:DESC"]);
      expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc');
    });

    it("normalizes mixed-case Desc to desc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:Desc"]);
      expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc');
    });

    // Regression test for GHSA-69xv-wmgg-3qp3: SQL injection via direction.
    // Invalid directions must throw a 400 — the malicious SQL never reaches
    // the database and the user gets an explicit error instead of silently
    // sorting ascending.
    it("rejects SQL injection payloads in the direction", () => {
      expect(() =>
        parseSortingOptions(["updatedAt:asc; DROP TABLE Asset; --"])
      ).toThrow(ShelfError);
    });

    // Regression test using the exact PoC shape from the GHSA-69xv-wmgg-3qp3
    // report. The split(":") only takes the first colon, so the entire
    // "asc,(SELECT ...)" string lands in `direction` and must be rejected.
    it("rejects the reporter's exact PoC subquery payload", () => {
      expect(() =>
        parseSortingOptions([
          "createdAt:asc,(SELECT CASE WHEN 1=2 THEN 1 ELSE 1/0 END)",
        ])
      ).toThrow(ShelfError);
    });

    it("throws on an unrecognized direction string", () => {
      expect(() => parseSortingOptions(["updatedAt:foobar"])).toThrow(
        ShelfError
      );
    });

    it("throws with HTTP 400 status on invalid direction", () => {
      try {
        parseSortingOptions(["updatedAt:nope"]);
        throw new Error("expected parseSortingOptions to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ShelfError);
        expect((err as ShelfError).status).toBe(400);
      }
    });

    it("defaults missing direction to asc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt"]);
      expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" asc');
    });

    it("defaults empty direction to asc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:"]);
      expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" asc');
    });
  });

  describe("barcode field validation", () => {
    it("permits a known-good barcode column", () => {
      const { orderByClause } = parseSortingOptions(["barcode_Code128:asc"]);
      expect(orderByClause).toContain("barcode_Code128");
      expect(orderByClause).toContain("asc");
    });

    it("drops a barcode field whose suffix contains injection chars", () => {
      const { orderByClause } = parseSortingOptions([
        'barcode_Code128";DROP--:asc',
      ]);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
      expect(orderByClause).not.toContain("DROP");
    });

    it("drops a barcode field with empty suffix", () => {
      const { orderByClause } = parseSortingOptions(["barcode_:asc"]);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
    });

    it("drops a barcode field with whitespace in the suffix", () => {
      const { orderByClause } = parseSortingOptions(["barcode_Code 128:asc"]);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
    });
  });

  describe("custom field (cf_*) validation", () => {
    it("permits a simple custom field name", () => {
      const { orderByClause, customFieldSortings } = parseSortingOptions([
        "cf_Manufacturer:asc:TEXT",
      ]);
      expect(customFieldSortings).toHaveLength(1);
      expect(customFieldSortings[0].alias).toBe("cf_Manufacturer");
      expect(orderByClause).toContain("cf_Manufacturer");
    });

    it("normalizes whitespace in custom field name to underscores", () => {
      const { customFieldSortings } = parseSortingOptions([
        "cf_legit name:asc:TEXT",
      ]);
      expect(customFieldSortings).toHaveLength(1);
      expect(customFieldSortings[0].alias).toBe("cf_legit_name");
    });

    it("drops a custom field name containing injection chars", () => {
      const { orderByClause, customFieldSortings } = parseSortingOptions([
        "cf_x;DROP TABLE:asc:TEXT",
      ]);
      expect(customFieldSortings).toHaveLength(0);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
      expect(orderByClause).not.toContain("DROP");
    });

    it("drops a custom field name containing parentheses", () => {
      const { orderByClause, customFieldSortings } = parseSortingOptions([
        "cf_Cost (USD):asc:AMOUNT",
      ]);
      expect(customFieldSortings).toHaveLength(0);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
    });

    it("uses direct sort for DATE fields", () => {
      const { orderByClause } = parseSortingOptions(["cf_x:asc:DATE"]);
      expect(orderByClause).toBe("ORDER BY cf_x asc");
    });

    it("uses ::numeric cast for AMOUNT fields", () => {
      const { orderByClause } = parseSortingOptions(["cf_x:asc:AMOUNT"]);
      expect(orderByClause).toBe("ORDER BY cf_x::numeric asc");
    });

    it("falls through to natural sort for unknown fieldType", () => {
      const { orderByClause } = parseSortingOptions(["cf_x:asc:bogusType"]);
      expect(orderByClause).toContain("LOWER(regexp_replace(cf_x");
    });
  });

  describe("mixed and edge cases", () => {
    it("emits valid terms while skipping invalid ones in the same array", () => {
      const { orderByClause, customFieldSortings } = parseSortingOptions([
        "updatedAt:desc",
        "cf_x;DROP:asc:TEXT",
        "name:asc",
      ]);
      expect(customFieldSortings).toHaveLength(0);
      expect(orderByClause).toContain('"assetUpdatedAt" desc');
      expect(orderByClause).toContain('"assetTitle"');
      expect(orderByClause).not.toContain("DROP");
    });

    it("falls back to default sort when every term is invalid", () => {
      const { orderByClause } = parseSortingOptions([
        "evil:asc",
        "alsoEvil:desc",
      ]);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
    });

    it("falls back to default sort for an empty input array", () => {
      const { orderByClause } = parseSortingOptions([]);
      expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
    });

    it("uses sequential-id sort expression for sequentialId", () => {
      const { orderByClause } = parseSortingOptions(["sequentialId:asc"]);
      expect(orderByClause).toContain('"assetSequentialId"');
      expect(orderByClause).toContain("LPAD(SPLIT_PART");
    });

    it("uses custody jsonb path for custody", () => {
      const { orderByClause } = parseSortingOptions(["custody:desc"]);
      expect(orderByClause).toContain("custody->>'name'");
      expect(orderByClause).toContain("desc");
    });

    // Regression test: `in` walks the prototype chain, so without
    // Object.hasOwn() field names like "toString" or "constructor" would
    // resolve to inherited methods and produce broken SQL. Must fall through
    // to the unknown-field branch instead.
    it("does not match inherited Object.prototype keys via 'in'", () => {
      const inheritedKeys = [
        "toString",
        "constructor",
        "hasOwnProperty",
        "valueOf",
      ];
      for (const key of inheritedKeys) {
        const { orderByClause } = parseSortingOptions([`${key}:asc`]);
        expect(orderByClause).toBe(DEFAULT_FALLBACK_ORDER_BY);
      }
    });
  });
});

describe("generateCustomFieldSelect", () => {
  it("returns Prisma.empty for an empty input", () => {
    const result = generateCustomFieldSelect([]);
    // Prisma.empty has no strings/values to interpolate
    expect(result.strings.join("")).toBe("");
  });

  it("emits a SELECT subquery for a safe alias", () => {
    const result = generateCustomFieldSelect([
      { name: "Manufacturer", valueKey: "raw", alias: "cf_Manufacturer" },
    ]);
    expect(result.strings.join("?")).toContain("AS ");
    expect(result.strings.join("?")).toContain("cf_Manufacturer");
  });

  // Defense-in-depth: even though parseSortingOptions already validates
  // aliases, generateCustomFieldSelect must not trust its input. A future
  // refactor or alternate caller must not be able to inject SQL via cf.alias.
  it("throws ShelfError when an alias contains unsafe characters", () => {
    expect(() =>
      generateCustomFieldSelect([
        { name: "x", valueKey: "raw", alias: "cf_x; DROP--" },
      ])
    ).toThrow(ShelfError);
  });

  it("throws ShelfError when an alias is empty", () => {
    expect(() =>
      generateCustomFieldSelect([{ name: "x", valueKey: "raw", alias: "" }])
    ).toThrow(ShelfError);
  });
});

/**
 * Helper to extract SQL string from Prisma.Sql object for testing
 * Joins the strings array to get a readable representation
 */
function getSqlString(sql: ReturnType<typeof generateWhereClause>): string {
  return sql.strings.join("?");
}

describe("generateWhereClause - special filter values", () => {
  const orgId = "test-org-id";

  describe("custody filter with special values", () => {
    it("handles 'in-custody' with is operator (includes active bookings)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "is",
        value: "in-custody",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should check both direct custody AND active bookings
      // Only counts booking custody when asset is CHECKED_OUT
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) > 0");
      expect(sql).toContain("a.status = 'CHECKED_OUT' AND EXISTS");
      expect(sql).toContain("Booking");
      expect(sql).toContain("ONGOING");
    });

    it("handles 'in-custody' with isNot operator (excludes both direct and booking custody)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "isNot",
        value: "in-custody",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should exclude both direct custody AND active bookings
      // Only counts booking custody when asset is CHECKED_OUT
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) = 0");
      expect(sql).toContain("a.status = 'CHECKED_OUT' AND EXISTS");
      expect(sql).toContain("Booking");
    });

    it("handles 'without-custody' with is operator (excludes active bookings too)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "is",
        value: "without-custody",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should exclude both direct custody AND active bookings
      // Only counts booking custody when asset is CHECKED_OUT
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) = 0");
      expect(sql).toContain("a.status = 'CHECKED_OUT' AND EXISTS");
      expect(sql).toContain("Booking");
    });

    it("handles containsAny with only 'in-custody' (includes active bookings)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "containsAny",
        value: "in-custody",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should check both direct custody AND active bookings
      // Only counts booking custody when asset is CHECKED_OUT
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) > 0");
      expect(sql).toContain("a.status = 'CHECKED_OUT' AND EXISTS");
      expect(sql).toContain("Booking");
    });

    it("handles containsAny with 'in-custody' + specific IDs (subsumes to in-custody)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "containsAny",
        value: "in-custody,specific-team-member-id",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // "in-custody" subsumes specific IDs - checks for any custody (direct or booking)
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) > 0");
      expect(sql).toContain("a.status = 'CHECKED_OUT' AND EXISTS");
      expect(sql).toContain("Booking");
      // Should NOT contain specific ID matching since in-custody covers all
      expect(sql).not.toContain("specific-team-member-id");
    });

    it("handles containsAny with both 'in-custody' and 'without-custody' (matches all)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "containsAny",
        value: "in-custody,without-custody",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should not add any custody-specific conditions (matches everything)
      expect(sql).not.toContain("jsonb_array_length(custody_agg.custody) = 0");
      expect(sql).not.toContain("jsonb_array_length(custody_agg.custody) > 0");
    });

    it("handles containsAny with 'without-custody' + specific IDs (OR logic)", () => {
      const filter: Filter = {
        name: "custody",
        type: "enum",
        operator: "containsAny",
        value: "without-custody,specific-team-member-id",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should include both conditions: no custody OR specific custodian
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) = 0");
      expect(sql).toContain("Custody");
    });
  });

  describe("location filter with special values", () => {
    it("handles 'in-location' with is operator", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "is",
        value: "in-location",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('"locationId" IS NOT NULL');
    });

    it("handles 'in-location' with isNot operator (inverts to no location)", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "isNot",
        value: "in-location",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('"locationId" IS NULL');
    });

    it("handles 'without-location' with is operator", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "is",
        value: "without-location",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('"locationId" IS NULL');
    });

    it("handles containsAny with only 'in-location'", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "containsAny",
        value: "in-location",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('"locationId" IS NOT NULL');
    });

    it("handles containsAny with both 'in-location' and 'without-location' (matches all)", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "containsAny",
        value: "in-location,without-location",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should not add any location-specific conditions
      expect(sql).not.toContain('"locationId" IS NULL');
      expect(sql).not.toContain('"locationId" IS NOT NULL');
    });

    it("handles containsAny with 'without-location' + specific IDs (OR logic)", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "containsAny",
        value: "without-location,specific-location-id",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should include both: no location OR specific location
      expect(sql).toContain('"locationId" IS NULL');
      expect(sql).toContain("Location");
    });
  });

  describe("kit filter with special values", () => {
    it("handles 'in-kit' with is operator", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "is",
        value: "in-kit",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('EXISTS (SELECT 1 FROM public."AssetKit" ak');
      expect(sql).toContain('ak."assetId" = a.id');
      expect(sql).not.toContain("NOT EXISTS");
    });

    it("handles 'in-kit' with isNot operator (inverts to not in kit)", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "isNot",
        value: "in-kit",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM public."AssetKit" ak');
      expect(sql).toContain('ak."assetId" = a.id');
    });

    it("handles 'without-kit' with is operator", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "is",
        value: "without-kit",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM public."AssetKit" ak');
      expect(sql).toContain('ak."assetId" = a.id');
    });

    it("handles containsAny with only 'in-kit'", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "containsAny",
        value: "in-kit",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('EXISTS (SELECT 1 FROM public."AssetKit" ak');
      expect(sql).toContain('ak."assetId" = a.id');
      expect(sql).not.toContain("NOT EXISTS");
    });

    it("handles containsAny with both 'in-kit' and 'without-kit' (matches all)", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "containsAny",
        value: "in-kit,without-kit",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      // Should not add any kit-specific conditions
      expect(sql).not.toContain('"AssetKit"');
    });

    it("handles containsAny with 'without-kit' + specific IDs (OR logic)", () => {
      const filter: Filter = {
        name: "kit",
        type: "enum",
        operator: "containsAny",
        value: "without-kit,specific-kit-id",
      };

      const result = generateWhereClause(orgId, null, [filter]);
      const sql = getSqlString(result);

      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM public."AssetKit" ak');
      expect(sql).toContain('ak."kitId" = ANY');
    });
  });
});

describe("assetQueryFragment", () => {
  /**
   * Helper to extract SQL string from Prisma.Sql for testing.
   * Joins the strings array to get a readable representation.
   */
  function getFragmentSqlString(sql: ReturnType<typeof assetQueryFragment>) {
    return sql.strings.join("?");
  }

  describe("custody output", () => {
    it("only includes booking custody when asset status is CHECKED_OUT", () => {
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // The CASE WHEN for booking-based custody must be guarded by CHECKED_OUT
      expect(sql).toContain(
        "WHEN b.id IS NOT NULL AND a.status = 'CHECKED_OUT' THEN"
      );
    });

    it("projects direct custody from the lateral aggregation", () => {
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // Direct custody now flows through the per-asset lateral
      // aggregation (custody_agg.custody) rather than a JOIN-based CASE
      // — this prevents per-custody-row duplication for qty-tracked
      // assets with multiple custodians (Issue A).
      expect(sql).toContain("custody_agg.custody");
      expect(sql).toContain("jsonb_array_length(custody_agg.custody) > 0");
    });

    it("does not gate the direct custody projection on CHECKED_OUT", () => {
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // Regression guard: the direct-custody branch must remain
      // independent of asset status.
      expect(sql).not.toContain(
        "jsonb_array_length(custody_agg.custody) > 0 AND a.status = 'CHECKED_OUT'"
      );
    });
  });

  describe("custody lateral aggregation (Issue A)", () => {
    /**
     * The lateral-subquery pattern (mirroring the barcodes lateral) is
     * what makes a single asset return one row regardless of how many
     * custody rows it has. Without this, the previous direct LEFT JOINs
     * on Custody + TeamMember + User caused the asset to be returned N
     * times for N custodians.
     */
    function getJoinsSqlString(sql: typeof assetQueryJoins) {
      return sql.strings.join("?");
    }

    it("aggregates custody rows via a lateral subquery, not direct JOINs", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // The lateral aliased as `custody_agg` must exist
      expect(sql).toContain("LEFT JOIN LATERAL");
      expect(sql).toContain(") custody_agg ON TRUE");

      // jsonb_agg over Custody is what produces the multi-row array
      expect(sql).toContain("jsonb_agg(");
      expect(sql).toContain('FROM public."Custody" cu');
    });

    it("does not LEFT JOIN Custody at the outer level", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // The outer-level direct join on Custody (`LEFT JOIN public."Custody"
      // cu ON cu."assetId" = a.id`) was the root cause of duplication.
      // It must now live exclusively inside the lateral subquery — the
      // outer query may no longer reference cu without a `FROM` clause.
      expect(sql).not.toMatch(
        /LEFT JOIN public\."Custody" cu ON cu\."assetId" = a\.id/
      );
    });

    it("keeps TeamMember/User joins scoped inside the custody lateral", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // The outer query exposes `bu` (booking User) and `btm`
      // (booking TeamMember). It must NOT carry direct outer joins on
      // `tm` / `u` that hang off `cu` — those belong in the lateral.
      // Strip the lateral block then assert.
      const outerOnly = sql.replace(
        /LEFT JOIN LATERAL \([\s\S]*?\) custody_agg ON TRUE/,
        ""
      );
      expect(outerOnly).not.toMatch(
        /LEFT JOIN public\."TeamMember" tm ON cu\."teamMemberId" = tm\.id/
      );
      expect(outerOnly).not.toMatch(
        /LEFT JOIN public\."User" u ON tm\."userId" = u\.id/
      );
    });

    it("includes per-custody quantity in the aggregated jsonb objects", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // qty-tracked assets need the per-custody-row quantity exposed so
      // the UI can render `name (quantity)` for each custodian.
      expect(sql).toContain("'quantity', cu.quantity");
    });

    it("falls back to '[]'::jsonb when an asset has no custody rows", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // COALESCE ensures custody_agg.custody is always an array, never
      // null — keeps the CASE branch in assetQueryFragment simple.
      expect(sql).toContain("COALESCE(");
      expect(sql).toContain("'[]'::jsonb");
    });
  });

  describe("withCustomFieldDefinitions option", () => {
    it("includes full definitions by default (matches AdvancedIndexAsset type)", () => {
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // Default should include all definition columns
      expect(sql).toContain("helpText");
      expect(sql).toContain("cf.required");
      expect(sql).toContain("cf.options");
      expect(sql).toContain("categories");
      expect(sql).toContain("_CategoryToCustomField");
      expect(sql).toContain("Category");
    });

    it("excludes full definitions when withCustomFieldDefinitions is false", () => {
      const fragment = assetQueryFragment({
        withCustomFieldDefinitions: false,
      });
      const sql = getFragmentSqlString(fragment);

      // Should include basic custom field columns
      expect(sql).toContain("customField");
      expect(sql).toContain("cf.id");
      expect(sql).toContain("cf.name");
      expect(sql).toContain("cf.type");

      // Should NOT include definition-only columns
      expect(sql).not.toContain("helpText");
      expect(sql).not.toContain("cf.required");
      expect(sql).not.toContain("cf.options");
      expect(sql).not.toContain("categories");
      expect(sql).not.toContain("_CategoryToCustomField");
    });
  });
});
