// @vitest-environment node
/**
 * Tests for bulk-operation asset-id resolution helpers.
 *
 * Two suites, two concerns:
 *  - `resolveAssetIdsForBulkOperation` — the select-all timezone off-by-one
 *    guard: in ADVANCED mode it must forward the acting user's IANA timezone
 *    into the raw filter query so built-in date-column filters truncate the
 *    calendar day in the user's tz (a UTC-only resolution near a day boundary
 *    mutates adjacent-day assets). These tests assert the resolved id SET
 *    actually depends on the forwarded timezone.
 *  - pool join gate: the per-asset `pool` LATERAL joins a select-all only
 *    when its WHERE reads pool.* (a pool column filter or the low stock
 *    toggle), the same gate the index's cheap phase uses.
 *  - list scope: a Base or Self Service caller's select-all, in either mode,
 *    is limited to the assets their list shows (`bookableScope`).
 *  - `buildAdvancedFilteredAssetIdsQuery` — the raw-SQL shape guard
 *    (SHELF-WEBAPP-21X): raw SQL isn't typechecked, so a string assertion
 *    ensures location joins through the `AssetLocation` pivot and never
 *    references the dropped `Asset.locationId` column.
 *
 * @see {@link file://./bulk-operations-helper.server.ts}
 */
import { Prisma, type AssetIndexSettings } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { db } from "~/database/db.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  buildAdvancedFilteredAssetIdsQuery,
  resolveAssetIdsForBulkOperation,
} from "./bulk-operations-helper.server";
import { bookableListScopeWhere } from "./list-scope.server";
import type { BookableListScope } from "./list-scope.server";
import { parseFiltersWithHierarchy } from "./query.server";

// why: the advanced select-all path issues a raw `$queryRaw` and the simple one
// an `asset.findMany`; stub both to avoid a real DB, to return a tz-dependent
// id set (proving the tz reaches the SQL and changes which rows match near a
// day boundary), and to capture the simple-mode `where`. This stub also covers
// the module-scope db import that the `buildAdvancedFilteredAssetIdsQuery`
// suite relies on (its pure builder never touches db at runtime).
vi.mock("~/database/db.server", () => ({
  db: { $queryRaw: vi.fn(), asset: { findMany: vi.fn() } },
}));

// why: `parseFiltersWithHierarchy` hits the DB to resolve custom-field hierarchy;
// stub it to a fixed built-in `createdAt` date filter while keeping the REAL
// `generateWhereClause` so the timezone is genuinely bound into the query.
vi.mock("./query.server", async () => {
  // Cast to a record so we can spread the real module without an inline
  // `import()` type annotation (forbidden by consistent-type-imports).
  const actual = (await vi.importActual("./query.server")) as Record<
    string,
    unknown
  >;
  return { ...actual, parseFiltersWithHierarchy: vi.fn() };
});

/**
 * ADVANCED settings so the resolver takes the raw-query branch. Only `mode` and
 * `columns` are read on this path; the rest is irrelevant here.
 */
const advancedSettings = {
  mode: "ADVANCED",
  columns: [],
} as unknown as AssetIndexSettings;

/**
 * A built-in `timestamptz` date filter — the class of filter whose calendar-day
 * boundary depends on the viewer's timezone.
 */
const createdAtFilter: Filter = {
  name: "createdAt",
  type: "date",
  operator: "is",
  value: "2026-07-20",
};

describe("resolveAssetIdsForBulkOperation - timezone forwarding", () => {
  /** Captures the raw SQL sent to `$queryRaw` so we can assert the bound tz. */
  const capturedQueries: Prisma.Sql[] = [];

  beforeEach(() => {
    capturedQueries.length = 0;
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([createdAtFilter]);

    // Return a DIFFERENT id set depending on the timezone bound into the query.
    // Mirrors reality: a non-UTC user's day boundary matches different rows than
    // a UTC boundary near midnight.
    vi.mocked(db.$queryRaw).mockImplementation(((query: Prisma.Sql) => {
      capturedQueries.push(query);
      return Promise.resolve(
        query.values.includes("Asia/Tokyo")
          ? [{ id: "tokyo-only-asset" }]
          : [{ id: "utc-only-asset" }]
      );
    }) as unknown as typeof db.$queryRaw);
  });

  it("forwards a non-UTC timezone into the filter query, changing the resolved id set", async () => {
    const tokyoIds = await resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess: "available" as const,
      bookableScope: null,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams: "createdAt=is:2026-07-20",
      settings: advancedSettings,
      timeZone: "Asia/Tokyo",
    });

    const utcIds = await resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess: "available" as const,
      bookableScope: null,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams: "createdAt=is:2026-07-20",
      settings: advancedSettings,
      timeZone: "UTC",
    });

    // The forwarded tz is bound into the SQL (`AT TIME ZONE $n`) — proving it is
    // not silently dropped on the way to the query.
    expect(capturedQueries[0]?.values).toContain("Asia/Tokyo");
    expect(capturedQueries[1]?.values).toContain("UTC");

    // The resolved id SET differs between timezones — the core E2 guarantee.
    expect(tokyoIds).toEqual(["tokyo-only-asset"]);
    expect(utcIds).toEqual(["utc-only-asset"]);
    expect(tokyoIds).not.toEqual(utcIds);
  });

  it("defaults the resolution timezone to UTC when none is supplied", async () => {
    const ids = await resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess: "available" as const,
      bookableScope: null,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams: "createdAt=is:2026-07-20",
      settings: advancedSettings,
    });

    expect(capturedQueries[0]?.values).toContain("UTC");
    expect(ids).toEqual(["utc-only-asset"]);
  });
});

describe("resolveAssetIdsForBulkOperation - lastAuditDate gating", () => {
  const capturedQueries: Prisma.Sql[] = [];

  const lastAuditFilter: Filter = {
    name: "lastAuditDate",
    type: "date",
    operator: "before",
    value: "2026-01-01",
  };

  const resolve = (
    lastAuditDateAccess: "available" | "locked" | "hidden",
    currentSearchParams: string
  ) =>
    resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess,
      bookableScope: null,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams,
      settings: advancedSettings,
    });

  beforeEach(() => {
    capturedQueries.length = 0;
    vi.mocked(db.$queryRaw).mockImplementation(((query: Prisma.Sql) => {
      capturedQueries.push(query);
      return Promise.resolve([{ id: "asset-1" }]);
    }) as unknown as typeof db.$queryRaw);
  });

  it("refuses a lastAuditDate select-all when access is hidden", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([lastAuditFilter]);

    // An error, not an empty selection: the index shows every asset for this
    // URL, so an empty result would let a bulk action "succeed" on nothing.
    await expect(
      resolve("hidden", "lastAuditDate=before:2026-01-01")
    ).rejects.toMatchObject({ status: 400 });
    expect(capturedQueries).toHaveLength(0);
  });

  it("refuses a lastAuditDate select-all when access is locked", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([lastAuditFilter]);

    // An error, not an empty selection: the index shows every asset for this
    // URL, so an empty result would let a bulk action "succeed" on nothing.
    await expect(
      resolve("locked", "lastAuditDate=before:2026-01-01")
    ).rejects.toMatchObject({ status: 400 });
    expect(capturedQueries).toHaveLength(0);
  });

  it("applies the lastAuditDate filter when access is available", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([lastAuditFilter]);

    const ids = await resolve("available", "lastAuditDate=before:2026-01-01");

    expect(ids).toEqual(["asset-1"]);
    expect(capturedQueries[0]?.strings.join("?")).toContain('"completedAt"');
  });

  it("still resolves a select-all without a lastAuditDate filter when hidden", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([createdAtFilter]);

    const ids = await resolve("hidden", "createdAt=is:2026-07-20");

    expect(ids).toEqual(["asset-1"]);
    expect(capturedQueries[0]?.strings.join("?")).not.toContain(
      '"completedAt"'
    );
  });
});

describe("buildAdvancedFilteredAssetIdsQuery", () => {
  // Raw SQL isn't typechecked, so the join/column shape is guarded by a string
  // assertion per `.claude/rules/raw-sql-respects-prisma-map.md`. Regression for
  // SHELF-WEBAPP-21X: the query referenced the dropped `Asset.locationId`
  // column and 500'd (`42703: column a.locationId does not exist`).
  const sql = buildAdvancedFilteredAssetIdsQuery(Prisma.empty, {
    withPool: false,
  }).strings.join("?");

  it("joins location through the AssetLocation pivot (LATERAL primary-pick)", () => {
    expect(sql).toContain('public."AssetLocation"');
    expect(sql).toContain("LEFT JOIN LATERAL");
  });

  it("does not reference the dropped Asset.locationId column", () => {
    expect(sql).not.toContain('a."locationId"');
  });

  it("still selects distinct asset ids and interpolates the where clause", () => {
    const withWhere = buildAdvancedFilteredAssetIdsQuery(
      Prisma.sql`WHERE a."organizationId" = ${"org-1"}`,
      { withPool: false }
    );
    expect(withWhere.strings.join("?")).toContain("SELECT DISTINCT a.id");
    // The org id is carried as a bound parameter, never interpolated inline.
    expect(withWhere.values).toContain("org-1");
  });
});

/** The `pool` LATERAL's alias line, present only when the join is emitted. */
const POOL_JOIN_MARKER = ") pool ON TRUE";

describe("buildAdvancedFilteredAssetIdsQuery - pool join", () => {
  it("omits the pool LATERAL when withPool is false", () => {
    const sql = buildAdvancedFilteredAssetIdsQuery(Prisma.empty, {
      withPool: false,
    }).strings.join("?");

    expect(sql).not.toContain(POOL_JOIN_MARKER);
  });

  it("adds the pool LATERAL when withPool is true", () => {
    const sql = buildAdvancedFilteredAssetIdsQuery(Prisma.empty, {
      withPool: true,
    }).strings.join("?");

    expect(sql).toContain(POOL_JOIN_MARKER);
  });
});

describe("resolveAssetIdsForBulkOperation - pool join gate", () => {
  const capturedQueries: Prisma.Sql[] = [];

  const stockStatusFilter: Filter = {
    name: "stockStatus",
    type: "enum",
    operator: "is",
    value: "LOW",
  };

  const resolve = (currentSearchParams: string) =>
    resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess: "available" as const,
      bookableScope: null,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams,
      settings: advancedSettings,
    });

  /** The SQL text of the one query the resolution sent. */
  const sentSql = () => capturedQueries[0]?.strings.join("?") ?? "";

  beforeEach(() => {
    capturedQueries.length = 0;
    vi.mocked(db.$queryRaw).mockImplementation(((query: Prisma.Sql) => {
      capturedQueries.push(query);
      return Promise.resolve([{ id: "asset-1" }]);
    }) as unknown as typeof db.$queryRaw);
  });

  it("does not join the pool aggregates when no filter reads them", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([createdAtFilter]);

    await resolve("createdAt=is:2026-07-20");

    expect(capturedQueries).toHaveLength(1);
    expect(sentSql()).not.toContain(POOL_JOIN_MARKER);
  });

  it("joins the pool aggregates for a Stock status filter", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([stockStatusFilter]);

    await resolve("stockStatus=is:LOW");

    expect(sentSql()).toContain(POOL_JOIN_MARKER);
    expect(sentSql()).toContain("pool.in_custody");
  });

  it("joins the pool aggregates for the low stock toggle", async () => {
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([]);

    await resolve("lowStockOnly=true");

    expect(sentSql()).toContain(POOL_JOIN_MARKER);
    expect(sentSql()).toContain('a."minQuantity" IS NOT NULL');
  });
});

describe("resolveAssetIdsForBulkOperation - list scope", () => {
  /** A Base or Self Service member's scope (see `resolveBookableListScope`). */
  const scope: BookableListScope = { holderUserId: "user-base" };

  const simpleSettings = {
    mode: "SIMPLE",
    columns: [],
  } as unknown as AssetIndexSettings;

  const capturedQueries: Prisma.Sql[] = [];

  const resolve = ({
    settings,
    currentSearchParams,
    bookableScope,
  }: {
    settings: AssetIndexSettings;
    currentSearchParams: string;
    bookableScope: BookableListScope | null;
  }) =>
    resolveAssetIdsForBulkOperation({
      // Not the subject of these tests; the narrowing has its own suite.
      allowedTeamMemberIds: "all" as const,
      lastAuditDateAccess: "available" as const,
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams,
      settings,
      bookableScope,
    });

  /** The `where` the simple-mode select-all sent to `asset.findMany`. */
  const simpleWhere = () =>
    (
      vi.mocked(db.asset.findMany).mock.calls[0]?.[0] as
        | { where?: Prisma.AssetWhereInput }
        | undefined
    )?.where;

  /** The SQL text of the one advanced query the resolution sent. */
  const sentSql = () => capturedQueries[0]?.strings.join("?") ?? "";

  beforeEach(() => {
    capturedQueries.length = 0;
    vi.mocked(db.asset.findMany).mockReset();
    vi.mocked(db.asset.findMany).mockResolvedValue([
      { id: "asset-1" },
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);
    vi.mocked(db.$queryRaw).mockImplementation(((query: Prisma.Sql) => {
      capturedQueries.push(query);
      return Promise.resolve([{ id: "asset-1" }]);
    }) as unknown as typeof db.$queryRaw);
    vi.mocked(parseFiltersWithHierarchy).mockResolvedValue([createdAtFilter]);
  });

  it("limits a simple-mode select-all to the caller's list scope", async () => {
    const ids = await resolve({
      settings: simpleSettings,
      currentSearchParams: "status=AVAILABLE",
      bookableScope: scope,
    });

    expect(ids).toEqual(["asset-1"]);
    expect(simpleWhere()?.organizationId).toBe("org-1");
    expect(simpleWhere()?.AND).toContainEqual(bookableListScopeWhere(scope));
  });

  it("leaves a simple-mode select-all unscoped for a member who sees every asset", async () => {
    await resolve({
      settings: simpleSettings,
      currentSearchParams: "status=AVAILABLE",
      bookableScope: null,
    });

    expect(simpleWhere()?.organizationId).toBe("org-1");
    expect(JSON.stringify(simpleWhere())).not.toContain("availableToBook");
  });

  it("limits an advanced-mode select-all to the caller's list scope", async () => {
    const ids = await resolve({
      settings: advancedSettings,
      currentSearchParams: "createdAt=is:2026-07-20",
      bookableScope: scope,
    });

    expect(ids).toEqual(["asset-1"]);
    expect(capturedQueries).toHaveLength(1);
    expect(sentSql()).toContain('a."availableToBook" = true');
    expect(capturedQueries[0]?.values).toContain("user-base");
  });

  it("leaves an advanced-mode select-all unscoped for a member who sees every asset", async () => {
    await resolve({
      settings: advancedSettings,
      currentSearchParams: "createdAt=is:2026-07-20",
      bookableScope: null,
    });

    expect(capturedQueries).toHaveLength(1);
    expect(sentSql()).not.toContain("availableToBook");
  });
});
