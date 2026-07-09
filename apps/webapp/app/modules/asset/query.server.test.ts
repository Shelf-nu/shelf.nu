import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { locationDescendantsMock } from "@mocks/location-descendants";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { ShelfError } from "~/utils/error";
import {
  assetQueryFragment,
  assetQueryJoins,
  buildAdvancedAssetsQuery,
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

    // Explicit sorts carry a stable `"assetId" ASC` tiebreaker for deterministic
    // pagination across rows tied on the sort key.
    expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc, "assetId" ASC');
  });

  // The inner clause feeds `ROW_NUMBER() OVER (ORDER BY ...)` in the
  // paginate-first rewrite: it must equal the full clause minus the leading
  // "ORDER BY " token, for both explicit and default sorts.
  it("exposes the inner order-by (no leading ORDER BY) for an explicit sort", () => {
    const { orderByClause, orderByInner } = parseSortingOptions([
      "updatedAt:desc",
    ]);
    expect(orderByInner).toBe('"assetUpdatedAt" desc, "assetId" ASC');
    expect(orderByClause).toBe(`ORDER BY ${orderByInner}`);
  });

  it("does not duplicate the assetId tiebreaker when the sort already uses id", () => {
    // `id` maps to the "assetId" column, so the tiebreaker must not be appended
    // again (otherwise ORDER BY would list "assetId" twice).
    const { orderByInner } = parseSortingOptions(["id:asc"]);
    expect(orderByInner).toBe('"assetId" asc');
    expect(orderByInner.match(/"assetId"/g)).toHaveLength(1);

    // Also deduped when id is a secondary sort term.
    const combo = parseSortingOptions(["name:asc", "id:desc"]).orderByInner;
    expect(combo.match(/"assetId"/g)).toHaveLength(1);
  });

  it("exposes the inner order-by for the default (no-sort) fallback", () => {
    const { orderByInner } = parseSortingOptions([]);
    expect(orderByInner).toBe('"assetCreatedAt" DESC, "assetId" ASC');
  });

  describe("direction validation", () => {
    it("normalizes uppercase DESC to desc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:DESC"]);
      // Explicit sorts get a stable `"assetId" ASC` tiebreaker so paging is
      // deterministic across rows tied on the sort key.
      expect(orderByClause).toBe(
        'ORDER BY "assetUpdatedAt" desc, "assetId" ASC'
      );
    });

    it("normalizes mixed-case Desc to desc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:Desc"]);
      expect(orderByClause).toBe(
        'ORDER BY "assetUpdatedAt" desc, "assetId" ASC'
      );
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
      expect(orderByClause).toBe(
        'ORDER BY "assetUpdatedAt" asc, "assetId" ASC'
      );
    });

    it("defaults empty direction to asc", () => {
      const { orderByClause } = parseSortingOptions(["updatedAt:"]);
      expect(orderByClause).toBe(
        'ORDER BY "assetUpdatedAt" asc, "assetId" ASC'
      );
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
      expect(orderByClause).toBe('ORDER BY cf_x asc, "assetId" ASC');
    });

    it("uses ::numeric cast for AMOUNT fields", () => {
      const { orderByClause } = parseSortingOptions(["cf_x:asc:AMOUNT"]);
      expect(orderByClause).toBe('ORDER BY cf_x::numeric asc, "assetId" ASC');
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
      // Regression (custody-sort no-op): the `custody` column is a jsonb
      // ARRAY (`Custody[]`) since the quantity-tracked multi-custodian
      // refactor, not a single object. `custody->>'name'` on an array
      // returns NULL for every row (asc == desc, only the id tiebreaker
      // orders), so we must index the first element: `custody->0->>'name'`.
      expect(orderByClause).toContain("custody->0->>'name'");
      // Guard against a regression back to the object-shaped key that
      // silently no-ops on the array.
      expect(orderByClause).not.toContain("custody->>'name'");
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

      // An asset has a location iff at least one AssetLocation pivot row exists.
      expect(sql).toContain(
        'EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)'
      );
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

      expect(sql).toContain(
        'NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)'
      );
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

      expect(sql).toContain(
        'NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)'
      );
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

      expect(sql).toContain(
        'EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)'
      );
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
      expect(sql).not.toContain('"AssetLocation"');
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

      // Should include both branches: no AssetLocation row OR a row for the
      // specific location id.
      expect(sql).toContain(
        'NOT EXISTS (SELECT 1 FROM public."AssetLocation" al WHERE al."assetId" = a.id)'
      );
      expect(sql).toContain('"AssetLocation"');
      expect(sql).toContain('al."locationId" = ANY');
    });

    // why: regression test for SHELF-WEBAPP-1MY — a `withinHierarchy` location
    // filter pointing at a deleted/stale location expands to a `containsAny`
    // filter with an empty array of descendant ids. The builder must not call
    // `Prisma.join([])` (which throws) and should match no assets instead of
    // crashing the entire /assets index with a 500.
    it("handles containsAny with an empty array (expanded withinHierarchy to no descendants)", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "containsAny",
        value: [],
      };

      expect(() => generateWhereClause(orgId, null, [filter])).not.toThrow();

      const sql = getSqlString(generateWhereClause(orgId, null, [filter]));
      // An empty location set matches no assets.
      expect(sql).toContain("1=0");
    });

    it("handles containsAny with an empty string (no location ids) without throwing", () => {
      const filter: Filter = {
        name: "location",
        type: "enum",
        operator: "containsAny",
        value: "",
      };

      expect(() => generateWhereClause(orgId, null, [filter])).not.toThrow();

      const sql = getSqlString(generateWhereClause(orgId, null, [filter]));
      expect(sql).toContain("1=0");
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

  // why: regression coverage for SHELF-WEBAPP-1MY and its sibling branches. A
  // `containsAny` filter whose id list resolves to empty (e.g. a stale
  // `withinHierarchy` expansion, or an empty submitted value) must never call
  // `Prisma.join([])` (which throws and 500s the /assets index). Every such
  // branch should instead emit a no-match clause (`1=0`).
  describe("containsAny with an empty id set is non-fatal (matches nothing)", () => {
    const cases: { name: Filter["name"] }[] = [
      { name: "location" },
      { name: "category" },
      { name: "kit" },
      { name: "custody" },
      { name: "upcomingBookings" },
    ];

    for (const { name } of cases) {
      it(`handles empty containsAny for "${name}" without throwing`, () => {
        const filter = {
          name,
          type: "enum",
          operator: "containsAny",
          value: [] as string[],
        } as Filter;

        expect(() => generateWhereClause(orgId, null, [filter])).not.toThrow();
        expect(
          getSqlString(generateWhereClause(orgId, null, [filter]))
        ).toContain("1=0");
      });
    }
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

    it("falls back to the NRM team-member name for booking custody", () => {
      // why: when the booking custodian is an NRM (TeamMember with no User),
      // Postgres CONCAT returns ' ' (a space, non-NULL) for the absent user, so
      // the old COALESCE(CONCAT(...), btm.name) never reached the NRM name and the
      // badge rendered blank. The name must be guarded on bu.id with a btm.name
      // fallback instead.
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // The buggy COALESCE(CONCAT(...)) pattern must be gone
      expect(sql).not.toContain('COALESCE(CONCAT(bu."firstName"');
      // Booking custody name must fall back to the team-member (NRM) name
      expect(sql).toContain("ELSE btm.name");
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

    it("orders the custody aggregation deterministically for a stable primary", () => {
      const sql = getJoinsSqlString(assetQueryJoins);

      // The custody sort key (`custody->0->>'name'`) and the rendered badge
      // (formatCustodyList picks custody[0]) both rely on element 0 being
      // the primary custodian. jsonb_agg has an undefined input order without
      // an explicit ORDER BY, so a multi-custodian (qty-tracked) asset's
      // primary — and thus its sort key — could otherwise vary by plan and
      // disagree with the badge. Oldest-first (createdAt, id) matches the
      // kit/location primary-pick convention.
      expect(sql).toContain('ORDER BY cu."createdAt" ASC, cu.id ASC');
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

  describe("withBookings option (availability view)", () => {
    /**
     * The availability calendar folds the per-(asset, booking) BookingAsset
     * pivot rows into one bar and needs each slice's `assetKitId`, booked
     * `quantity`, and resolved kit name. Typecheck cannot validate the raw SQL
     * (`Prisma.sql` is just a string to TS), so a wrong-column refactor would
     * only surface as a 500 — per .claude/rules/raw-sql-respects-prisma-map
     * item 4, guard the column/join names with a cheap string assertion.
     * (No @map trap here: BookingAsset.quantity/assetKitId and Kit.name are
     * unmapped, so the Prisma field names equal the DB column names.)
     */
    it("projects per-slice pivot columns and resolves kit name via joins", () => {
      const fragment = assetQueryFragment({ withBookings: true });
      const sql = getFragmentSqlString(fragment);

      // Per-slice pivot metadata the fold reads (booked units, kit membership).
      expect(sql).toContain('atb."assetKitId"');
      expect(sql).toContain('atb."quantity"');
      // Kit name resolved through org-scoped AssetKit -> Kit joins, using
      // aliases (bk_ak/bk_kit) distinct from the outer query's own-kit ak/k.
      expect(sql).toContain("'kitName', bk_kit.name");
      expect(sql).toContain('LEFT JOIN public."AssetKit" bk_ak');
      // Org-scoped so a cross-org assetKitId resolves to NULL, never a leak.
      expect(sql).toContain('bk_ak."organizationId" = a."organizationId"');
      expect(sql).toContain(
        'LEFT JOIN public."Kit" bk_kit ON bk_ak."kitId" = bk_kit.id'
      );
    });

    it("omits the bookings subquery entirely when withBookings is false", () => {
      const fragment = assetQueryFragment();
      const sql = getFragmentSqlString(fragment);

      // Default (table views) must not pay for the availability-only subquery.
      expect(sql).not.toContain("AS bookings");
      expect(sql).not.toContain('atb."assetKitId"');
      expect(sql).not.toContain("'kitName', bk_kit.name");
    });
  });
});

describe("generateWhereClause - barcode value case normalization", () => {
  const orgId = "test-org-id";

  /**
   * ExternalQR barcodes are stored with their original case (see
   * `normalizeBarcodeValue`), so an exact-match filter must NOT uppercase the
   * supplied value — otherwise `b.value = ...` never matches a lowercase code.
   * Regression test for the `is` operator dropping ExternalQR matches.
   */
  it("preserves original case for ExternalQR with the 'is' operator", () => {
    const filter: Filter = {
      name: "barcode_ExternalQR",
      type: "string",
      operator: "is",
      value: "813e1ae5",
    };

    const result = generateWhereClause(orgId, null, [filter]);

    // The interpolated value must keep its original case for ExternalQR
    expect(result.values).toContain("813e1ae5");
    expect(result.values).not.toContain("813E1AE5");
  });

  it("preserves original case for ExternalQR with the 'isNot' operator", () => {
    const filter: Filter = {
      name: "barcode_ExternalQR",
      type: "string",
      operator: "isNot",
      value: "813e1ae5",
    };

    const result = generateWhereClause(orgId, null, [filter]);

    expect(result.values).toContain("813e1ae5");
    expect(result.values).not.toContain("813E1AE5");
  });

  it("preserves original case for ExternalQR with the 'matchesAny' operator", () => {
    const filter: Filter = {
      name: "barcode_ExternalQR",
      type: "string",
      operator: "matchesAny",
      value: "813e1ae5,abc9Def0",
    };

    const result = generateWhereClause(orgId, null, [filter]);

    expect(result.values).toContain("813e1ae5");
    expect(result.values).toContain("abc9Def0");
  });

  /**
   * Non-ExternalQR barcode types (Code128, Code39, …) are stored uppercased,
   * so their exact-match filters must continue to uppercase the supplied value.
   */
  it("uppercases the value for Code128 with the 'is' operator", () => {
    const filter: Filter = {
      name: "barcode_Code128",
      type: "string",
      operator: "is",
      value: "abc123",
    };

    const result = generateWhereClause(orgId, null, [filter]);

    expect(result.values).toContain("ABC123");
    expect(result.values).not.toContain("abc123");
  });
});

describe("generateWhereClause - tag EXISTS-ification (slim-phase enabler)", () => {
  const orgId = "test-org-id";

  /**
   * The paginate-first rewrite drops the fanning `LEFT JOIN _AssetToTag + Tag`
   * from the cheap phase, so any tag reference in the WHERE clause must be a
   * self-contained per-asset EXISTS (not a bare `t.name`/`t.id` against an
   * outer join alias). These tests lock that shape.
   */
  it("EXISTS-ifies the tag-name search (per-asset scoped, not a fanning join)", () => {
    const sql = getSqlString(generateWhereClause(orgId, "widget", []));

    // The tag search must be an EXISTS over _AssetToTag JOIN Tag scoped to the
    // current asset — never a bare `t.name ILIKE` disjunct against an outer
    // join that would force a GROUP BY.
    expect(sql).toContain('SELECT 1 FROM public."_AssetToTag" att');
    expect(sql).toContain('JOIN public."Tag" t ON att."B" = t.id');
    expect(sql).toContain('WHERE att."A" = a.id AND t.name ILIKE');
  });

  it("EXISTS-ifies a single-tag `contains` filter", () => {
    const filter: Filter = {
      name: "tags",
      type: "array",
      operator: "contains",
      value: "tag-1",
    };
    const sql = getSqlString(generateWhereClause(orgId, null, [filter]));

    // No bare `t.id = ` against an outer alias; must be a scoped EXISTS whose
    // `t.id =` predicate lives inside a per-asset subquery. Tables are
    // schema-qualified (`public.`) to match the rest of the module.
    expect(sql).toContain('SELECT 1 FROM public."_AssetToTag" att');
    expect(sql).toContain('JOIN public."Tag" t ON att."B" = t.id');
    expect(sql).toContain('WHERE att."A" = a.id AND t.id =');
  });

  it("EXISTS-ifies a multi-tag `containsAny` filter", () => {
    const filter: Filter = {
      name: "tags",
      type: "array",
      operator: "containsAny",
      value: "tag-1,tag-2",
    };
    const sql = getSqlString(generateWhereClause(orgId, null, [filter]));

    expect(sql).toContain('WHERE att."A" = a.id AND t.id = ANY');
  });
});

describe("buildAdvancedAssetsQuery", () => {
  /** Joins the raw SQL segments; interpolated values render as `?`. */
  function getQuerySqlString(sql: Prisma.Sql): string {
    return sql.strings.join("?");
  }

  /**
   * Assembles the query through the real builder + fragments, mirroring the
   * service call site so these assertions lock the shipped shape.
   */
  function build(overrides?: {
    sortBy?: string[];
    parsedFilters?: Filter[];
    withBookings?: boolean;
    withBarcodes?: boolean;
    search?: string | null;
  }): Prisma.Sql {
    const sortBy = overrides?.sortBy ?? [];
    const parsedFilters = overrides?.parsedFilters ?? [];
    const search = overrides?.search ?? null;
    const whereClause = generateWhereClause("org-1", search, parsedFilters);
    const { orderByInner, customFieldSortings } = parseSortingOptions(sortBy);
    return buildAdvancedAssetsQuery({
      whereClause,
      orderByInner,
      customFieldSortings,
      sortBy,
      parsedFilters,
      withBookings: overrides?.withBookings ?? false,
      withBarcodes: overrides?.withBarcodes ?? false,
      paginationClause: Prisma.sql`LIMIT ${100} OFFSET ${0}`,
      hasSearch: Boolean(search),
    });
  }

  it("emits the three-CTE + lateral paginate-first skeleton", () => {
    const sql = getQuerySqlString(build());

    expect(sql).toContain("WITH asset_query AS");
    expect(sql).toContain("sorted_asset_query AS");
    expect(sql).toContain("count_query AS");
    expect(sql).toContain("COUNT(*)::integer AS total_count");
    // Heavy projection runs once per page row via a correlated lateral.
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain('WHERE a.id = saq."assetId"');
  });

  it("freezes the sort into an integer ROW_NUMBER rank and replays it", () => {
    const sql = getQuerySqlString(build());

    // Default sort feeds the window; the array is ordered by the frozen rank.
    expect(sql).toContain(
      'ROW_NUMBER() OVER (ORDER BY "assetCreatedAt" DESC, "assetId" ASC)'
    );
    expect(sql).toContain('AS "__sortRank"');
    expect(sql).toContain('ORDER BY saq."__sortRank"');
  });

  it("keeps the slim cheap phase to id + light sort keys (no heavy projection)", () => {
    const sql = getQuerySqlString(build());

    // Base sort keys are always selected directly off the scan.
    expect(sql).toContain('a.value AS "assetValue"');
    expect(sql).toContain('a.quantity AS "assetQuantity"');
  });

  it("gates a name-sort column in the cheap phase on the active sort", () => {
    // The heavy projection always selects `k.name AS "kitName"` (for display),
    // so isolate the CHEAP phase (everything before `sorted_asset_query`) to
    // assert the gating: default sort omits the name joins/selects there — the
    // residual-O(N) fix — and sorting by one brings it back.
    const cheap = (overrides?: Parameters<typeof build>[0]) => {
      const sql = getQuerySqlString(build(overrides));
      return sql.slice(0, sql.indexOf("sorted_asset_query"));
    };
    const def = cheap({ sortBy: [] });
    expect(def).not.toContain('k.name AS "kitName"');
    expect(def).not.toContain('l.name AS "locationName"');

    expect(cheap({ sortBy: ["kit:asc"] })).toContain('k.name AS "kitName"');
    expect(cheap({ sortBy: ["location:asc"] })).toContain(
      'l.name AS "locationName"'
    );
  });

  it("keeps Category/Location joins for text search even without a name sort", () => {
    // The search predicate references c.name / l.name in the WHERE, so a search
    // must resolve those joins (independent of any sort). `c.name ILIKE` only
    // appears when a search is active, so it is the reliable signal.
    expect(getQuerySqlString(build({ search: "widget" }))).toContain(
      "c.name ILIKE"
    );
    expect(getQuerySqlString(build({ sortBy: [] }))).not.toContain(
      "c.name ILIKE"
    );
  });

  it("injects the barcode sort-key selects only when a barcode sort is active", () => {
    // withBarcodes:false ⇒ the heavy phase omits barcode scalars, so any
    // `AS barcode_Code128` must come from the cheap phase's sort-key select.
    const withBarcodeSort = getQuerySqlString(
      build({ sortBy: ["barcode_Code128:asc"], withBarcodes: false })
    );
    expect(withBarcodeSort).toContain("AS barcode_Code128");

    const withoutBarcodeSort = getQuerySqlString(
      build({ sortBy: [], withBarcodes: false })
    );
    expect(withoutBarcodeSort).not.toContain("AS barcode_Code128");
  });

  it("selects a.value (never valuation) — respects the @map column", () => {
    const sql = getQuerySqlString(build());
    expect(sql).toContain('a.value AS "assetValue"');
    expect(sql).not.toContain("a.valuation");
  });

  it("sorts custody by the first array element with a deterministic primary", () => {
    // `custody` is a jsonb array; the sort key must index element 0
    // (`custody->0->>'name'`), and the cheap-phase custody aggregation must
    // order its jsonb_agg so element 0 is stable and matches the badge.
    const sql = getQuerySqlString(build({ sortBy: ["custody:asc"] }));

    // Array-indexed sort key (never the object-shaped no-op `custody->>'name'`).
    expect(sql).toContain("custody->0->>'name'");
    expect(sql).not.toContain("custody->>'name'");
    // Cheap-phase custody aggregation is injected for the sort and carries the
    // deterministic ordering (mirrors the heavy phase).
    expect(sql).toContain(") custody_agg ON TRUE");
    expect(sql).toContain('ORDER BY cu."createdAt" ASC, cu.id ASC');
  });
});
