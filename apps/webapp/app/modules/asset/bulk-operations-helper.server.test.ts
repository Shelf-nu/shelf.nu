/**
 * Tests for select-all bulk-operation id resolution.
 *
 * Regression guard for the timezone off-by-one: when "select all" is active in
 * ADVANCED mode, {@link resolveAssetIdsForBulkOperation} must forward the acting
 * user's IANA timezone into the raw filter query so built-in date-column filters
 * truncate the calendar day in the user's tz. A UTC-only resolution near a day
 * boundary mutates adjacent-day assets. These tests assert the resolved id SET
 * actually depends on the forwarded timezone.
 *
 * @see {@link file://./bulk-operations-helper.server.ts}
 */
import type { Prisma } from "@prisma/client";
import { type AssetIndexSettings } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { db } from "~/database/db.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
import { parseFiltersWithHierarchy } from "./query.server";

// why: the advanced select-all path issues a raw `$queryRaw`; stub it to avoid a
// real DB and to return a tz-dependent id set (proving the tz reaches the SQL
// and changes which rows match near a day boundary).
vi.mock("~/database/db.server", () => ({
  db: { $queryRaw: vi.fn() },
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
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams: "createdAt=is:2026-07-20",
      settings: advancedSettings,
      timeZone: "Asia/Tokyo",
    });

    const utcIds = await resolveAssetIdsForBulkOperation({
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
      assetIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      currentSearchParams: "createdAt=is:2026-07-20",
      settings: advancedSettings,
    });

    expect(capturedQueries[0]?.values).toContain("UTC");
    expect(ids).toEqual(["utc-only-asset"]);
  });
});
