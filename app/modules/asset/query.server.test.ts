import { describe, expect, it, vi } from "vitest";
import { locationDescendantsMock } from "@mocks/location-descendants";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import {
  assetQueryFragment,
  generateWhereClause,
  parseSortingOptions,
} from "./query.server";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

describe("parseSortingOptions", () => {
  it("allows sorting by updatedAt", () => {
    const { orderByClause } = parseSortingOptions(["updatedAt:desc"]);

    expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc');
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
      expect(sql).toContain("cu.id IS NOT NULL");
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
      expect(sql).toContain("cu.id IS NULL");
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
      expect(sql).toContain("cu.id IS NULL");
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
      expect(sql).toContain("cu.id IS NOT NULL");
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
      expect(sql).toContain("cu.id IS NOT NULL");
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
      expect(sql).not.toContain("cu.id IS NULL");
      expect(sql).not.toContain("cu.id IS NOT NULL");
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
      expect(sql).toContain("cu.id IS NULL");
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

      expect(sql).toContain('"kitId" IS NOT NULL');
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

      expect(sql).toContain('"kitId" IS NULL');
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

      expect(sql).toContain('"kitId" IS NULL');
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

      expect(sql).toContain('"kitId" IS NOT NULL');
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
      expect(sql).not.toContain('"kitId" IS NULL');
      expect(sql).not.toContain('"kitId" IS NOT NULL');
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

      // Should include both: not in kit OR specific kit
      expect(sql).toContain('"kitId" IS NULL');
      expect(sql).toContain("Kit");
    });
  });
});

describe("assetQueryFragment - custody output", () => {
  /**
   * Helper to extract SQL string from Prisma.Sql for testing.
   * Joins the strings array to get a readable representation.
   */
  function getFragmentSqlString(sql: ReturnType<typeof assetQueryFragment>) {
    return sql.strings.join("?");
  }

  it("only includes booking custody when asset status is CHECKED_OUT", () => {
    const fragment = assetQueryFragment();
    const sql = getFragmentSqlString(fragment);

    // The CASE WHEN for booking-based custody must be guarded by CHECKED_OUT
    expect(sql).toContain(
      "WHEN b.id IS NOT NULL AND a.status = 'CHECKED_OUT' THEN"
    );
  });

  it("includes direct custody without CHECKED_OUT guard", () => {
    const fragment = assetQueryFragment();
    const sql = getFragmentSqlString(fragment);

    // Direct custody (via Custody table) should not require CHECKED_OUT
    expect(sql).toContain("WHEN cu.id IS NOT NULL THEN");
    expect(sql).not.toContain(
      "WHEN cu.id IS NOT NULL AND a.status = 'CHECKED_OUT'"
    );
  });
});
