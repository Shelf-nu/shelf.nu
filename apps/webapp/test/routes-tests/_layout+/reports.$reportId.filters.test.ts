/**
 * Report page loader: the filter bar's resolved filters reach the report.
 *
 * The page, the CSV export and the PDF export all resolve filters through
 * `resolveReportFilters`; this pins the page's half of that contract (each
 * report function receives the resolved values, and the bar receives its
 * chips), plus the redirect that brings legacy and comma-joined links into
 * the form the chips and pickers edit.
 *
 * @see {@link file://../../../app/routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://../../../app/modules/reports/filters.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { buildReportAssetFilter } from "~/modules/reports/asset-filter";
import type { ResolvedReportFilters } from "~/modules/reports/filters.server";
import { resolveReportFilters } from "~/modules/reports/filters.server";
import {
  assetActivityReport,
  bookingComplianceReport,
  custodySnapshotReport,
  overdueItemsReport,
  topBookedKitsReport,
} from "~/modules/reports/helpers.server";
import { loader } from "~/routes/_layout+/reports.$reportId";

// why: the caller's workspace comes from the permission check, which reads
// the membership from the database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(() =>
    Promise.resolve({
      organizationId: "org-1",
      organizations: [],
      currentOrganization: { currency: "USD" },
      access: { audits: { seeAll: true } },
    })
  ),
}));

// why: the plan gate reads the workspace owner's tier from the database; it
// has its own suite (reports-plan-gate.test.ts).
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/subscription.server")>()),
  workspaceCanUseReports: vi.fn().mockResolvedValue(true),
}));

// why: reads the acting user's saved format preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "MM_DD_YYYY",
    timeFormat: "H12",
    weekStartsOn: 0,
    timeZone: "UTC",
  }),
}));

// why: the resolver verifies ids against the database (its own suite covers
// that); the loader's contract is to hand on whatever it resolved.
vi.mock("~/modules/reports/filters.server", () => ({
  resolveReportFilters: vi.fn(),
  loadReportFilterOptions: vi.fn().mockResolvedValue({
    categories: [],
    totalCategories: 0,
    locations: [],
    totalLocations: 0,
    teamMembers: [],
    totalTeamMembers: 0,
    assetModels: [],
    totalAssetModels: 0,
    customFields: [],
    statuses: [],
  }),
}));

// why: the report queries are large database reads with their own tests;
// these cases are about what the loader hands them. `resolveTimeframe` stays
// real.
vi.mock("~/modules/reports/helpers.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "~/modules/reports/helpers.server"
  );
  return {
    ...actual,
    bookingComplianceReport: vi.fn(),
    overdueItemsReport: vi.fn(),
    custodySnapshotReport: vi.fn(),
    assetActivityReport: vi.fn(),
    topBookedKitsReport: vi.fn(),
  };
});

/** An empty payload, enough for the loader to finish. */
const EMPTY_REPORT = {
  report: { id: "x", title: "Report", description: "" },
  filters: { timeframe: {}, filters: [] },
  kpis: [],
  rows: [],
  computedMs: 0,
  totalRows: 0,
  page: 1,
  pageSize: 50,
};

const ASSET_FILTER = buildReportAssetFilter({ categoryIds: ["cat-1"] });

/** What the resolver answers in these cases. */
const RESOLVED: ResolvedReportFilters = {
  params: {
    categoryIds: ["cat-1"],
    locationIds: [],
    teamMemberId: "tm-1",
    statuses: ["COMPLETE"],
    assetModelIds: [],
    assetId: "asset-1",
    customFieldValues: [],
  },
  assetFilter: ASSET_FILTER,
  bookingStatuses: ["COMPLETE"],
  teamMemberId: "tm-1",
  assetId: "asset-1",
  active: [
    {
      type: "category",
      param: "category",
      value: "cat-1",
      label: "Category: Cameras",
    },
  ],
  ignoredCount: 2,
};

/** Runs the page loader for `reportId` with `query`. */
function load(reportId: string, query = "") {
  return loader(
    createLoaderArgs({
      request: new Request(`http://localhost/reports/${reportId}${query}`),
      params: { reportId },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as never)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveReportFilters).mockResolvedValue(RESOLVED);
  for (const report of [
    bookingComplianceReport,
    overdueItemsReport,
    custodySnapshotReport,
    assetActivityReport,
    topBookedKitsReport,
  ]) {
    vi.mocked(report).mockResolvedValue(EMPTY_REPORT as never);
  }
});

describe("report page loader: resolved filters", () => {
  it("hands Booking Compliance its statuses, custodian and asset filter", async () => {
    await load("booking-compliance");

    expect(bookingComplianceReport).toHaveBeenCalledWith(
      expect.objectContaining({
        statusFilter: ["COMPLETE"],
        custodianTeamMemberId: "tm-1",
        assetFilter: ASSET_FILTER,
      })
    );
  });

  it("hands Overdue Items and Custody Snapshot the custodian and asset filter", async () => {
    await load("overdue-items");
    await load("custody-snapshot");

    expect(overdueItemsReport).toHaveBeenCalledWith(
      expect.objectContaining({
        custodianTeamMemberId: "tm-1",
        assetFilter: ASSET_FILTER,
      })
    );
    expect(custodySnapshotReport).toHaveBeenCalledWith(
      expect.objectContaining({
        teamMemberId: "tm-1",
        assetFilter: ASSET_FILTER,
      })
    );
  });

  it("hands Asset Activity the chosen asset with the asset filter", async () => {
    await load("asset-activity");

    expect(assetActivityReport).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", assetFilter: ASSET_FILTER })
    );
  });

  it("hands Top Booked Kits the category and location as a kit filter", async () => {
    vi.mocked(resolveReportFilters).mockResolvedValue({
      ...RESOLVED,
      params: { ...RESOLVED.params, locationIds: ["loc-1"] },
    });

    await load("top-booked-kits");

    expect(topBookedKitsReport).toHaveBeenCalledWith(
      expect.objectContaining({
        kitFilter: { categoryIds: ["cat-1"], locationIds: ["loc-1"] },
      })
    );
  });

  it("returns the bar's chips and how many filters it left out", async () => {
    const result = (await load("custody-snapshot")) as unknown as {
      data: Record<string, unknown>;
    };

    expect(result.data).toMatchObject({
      activeFilters: RESOLVED.active,
      ignoredFilterCount: 2,
    });
  });
});

describe("report page loader: canonical filter links", () => {
  it("redirects a legacy or comma-joined link to the form the bar edits", async () => {
    const response = (await load(
      "asset-inventory",
      "?statuses=AVAILABLE,IN_CUSTODY&timeframe=last_7d"
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/reports/asset-inventory?status=AVAILABLE&status=IN_CUSTODY&timeframe=last_7d"
    );
    expect(resolveReportFilters).not.toHaveBeenCalled();
  });

  it("does not redirect a link that already is canonical", async () => {
    const result = await load("custody-snapshot", "?category=cat-1");

    expect(result).not.toBeInstanceOf(Response);
  });
});
