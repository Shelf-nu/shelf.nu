// @vitest-environment node
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { buildAdvancedFilteredAssetIdsQuery } from "./bulk-operations-helper.server";

// why: the module imports the db client at module scope; stub it so importing
// this pure query-builder never touches a real database.
vi.mock("~/database/db.server", () => ({ db: {} }));

describe("buildAdvancedFilteredAssetIdsQuery", () => {
  // Raw SQL isn't typechecked, so the join/column shape is guarded by a string
  // assertion per `.claude/rules/raw-sql-respects-prisma-map.md`. Regression for
  // SHELF-WEBAPP-21X: the query referenced the dropped `Asset.locationId`
  // column and 500'd (`42703: column a.locationId does not exist`).
  const sql = buildAdvancedFilteredAssetIdsQuery(Prisma.empty).strings.join(
    "?"
  );

  it("joins location through the AssetLocation pivot (LATERAL primary-pick)", () => {
    expect(sql).toContain('public."AssetLocation"');
    expect(sql).toContain("LEFT JOIN LATERAL");
  });

  it("does not reference the dropped Asset.locationId column", () => {
    expect(sql).not.toContain('a."locationId"');
  });

  it("still selects distinct asset ids and interpolates the where clause", () => {
    const withWhere = buildAdvancedFilteredAssetIdsQuery(
      Prisma.sql`WHERE a."organizationId" = ${"org-1"}`
    );
    expect(withWhere.strings.join("?")).toContain("SELECT DISTINCT a.id");
    // The org id is carried as a bound parameter, never interpolated inline.
    expect(withWhere.values).toContain("org-1");
  });
});
