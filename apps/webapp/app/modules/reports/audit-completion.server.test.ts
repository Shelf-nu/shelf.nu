/**
 * Audit Completion Report — Query & KPI Tests
 *
 * Covers the public `auditCompletionReport` function: that completion and
 * cancellation are read from their timestamp columns (never `status`, which
 * archiving rewrites), that the overdue KPI targets past-due unfinished
 * sessions, that per-row accuracy is null-safe, that the completion rate
 * follows the null-not-zero convention, and that pagination happens at the
 * database with a deterministic sort.
 *
 * @see {@link file://./audit-completion.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `helpers.server.test.ts`. The report issues four
// `count`s (window total for pagination + three KPI counts) distinguished by
// their where shapes, one `findMany` for the page of rows, and one
// `aggregate` for the missing-assets sum.
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { auditCompletionReport } from "./audit-completion.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/** A session row shaped like the report's `findMany` select. */
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    name: "Q1 Warehouse Audit",
    status: "COMPLETED",
    expectedAssetCount: 10,
    foundAssetCount: 8,
    missingAssetCount: 2,
    unexpectedAssetCount: 1,
    startedAt: new Date("2026-04-02T09:00:00Z"),
    dueDate: new Date("2026-04-20T00:00:00Z"),
    completedAt: new Date("2026-04-10T12:00:00Z"),
    createdBy: { firstName: "Jane", lastName: "Doe", displayName: "JD" },
    ...overrides,
  };
}

/**
 * Stubs the four `auditSession.count` calls by the distinguishing key of
 * each where shape. The shapes themselves are pinned by the where-clause
 * tests below — this helper only routes values to them.
 */
function stubCounts({
  windowTotal = 0,
  total = 0,
  completed = 0,
  overdue = 0,
}: {
  windowTotal?: number;
  total?: number;
  completed?: number;
  overdue?: number;
}) {
  vi.mocked(db.auditSession.count).mockImplementation(((args: {
    where?: Record<string, unknown>;
  }) => {
    const where = args?.where ?? {};
    if ("dueDate" in where) return Promise.resolve(overdue);
    if ("completedAt" in where) return Promise.resolve(completed);
    if ("cancelledAt" in where) return Promise.resolve(total);
    return Promise.resolve(windowTotal);
  }) as never);
}

/** Returns the where clause of the count call matched by `pick`. */
function findCountWhere(
  pick: (where: Record<string, unknown>) => boolean
): Record<string, unknown> | undefined {
  return vi
    .mocked(db.auditSession.count)
    .mock.calls.map(([args]) => (args as { where?: never })?.where ?? {})
    .find(pick);
}

describe("auditCompletionReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.auditSession.findMany).mockResolvedValue([] as never);
    stubCounts({});
    vi.mocked(db.auditSession.aggregate).mockResolvedValue({
      _sum: { missingAssetCount: null },
    } as never);
  });

  it("counts completion by completedAt, never by status", async () => {
    await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const completedWhere = findCountWhere((w) => "completedAt" in w);
    expect(completedWhere).toBeDefined();
    expect(completedWhere!.completedAt).toEqual({ not: null });
    // Archiving rewrites `status`, so the predicate must not reference it —
    // an ARCHIVED session that finished still counts as completed.
    expect(completedWhere).not.toHaveProperty("status");
  });

  it("keeps the raw status on rows, so an ARCHIVED-but-completed session renders as archived AND is counted completed", async () => {
    vi.mocked(db.auditSession.findMany).mockResolvedValue([
      makeSession({ id: "audit-archived", status: "ARCHIVED" }),
    ] as never);
    stubCounts({ windowTotal: 1, total: 1, completed: 1 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].status).toBe("ARCHIVED");
    expect(result.rows[0].completedAt).toEqual(
      new Date("2026-04-10T12:00:00Z")
    );
    const completedKpi = result.kpis.find((k) => k.id === "completed_audits");
    expect(completedKpi?.rawValue).toBe(1);
  });

  it("excludes cancelled sessions from the total via cancelledAt, not status", async () => {
    await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const totalWhere = findCountWhere(
      (w) => "cancelledAt" in w && !("completedAt" in w) && !("dueDate" in w)
    );
    expect(totalWhere).toBeDefined();
    expect(totalWhere!.cancelledAt).toBeNull();
    // A cancelled audit that is later archived keeps `cancelledAt` while its
    // status becomes ARCHIVED — a status-based exclusion would re-admit it.
    expect(totalWhere).not.toHaveProperty("status");
  });

  it("counts overdue as past-due sessions that are neither completed nor cancelled", async () => {
    const before = new Date();
    await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });
    const after = new Date();

    const overdueWhere = findCountWhere((w) => "dueDate" in w);
    expect(overdueWhere).toBeDefined();
    expect(overdueWhere!.completedAt).toBeNull();
    expect(overdueWhere!.cancelledAt).toBeNull();
    const dueDate = overdueWhere!.dueDate as { lt: Date };
    expect(dueDate.lt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(dueDate.lt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("sums missing assets over completed sessions only", async () => {
    vi.mocked(db.auditSession.aggregate).mockResolvedValue({
      _sum: { missingAssetCount: 7 },
    } as never);
    stubCounts({ windowTotal: 2, total: 2, completed: 2 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const aggregateArgs = vi.mocked(db.auditSession.aggregate).mock
      .calls[0][0] as {
      where: Record<string, unknown>;
      _sum: Record<string, unknown>;
    };
    expect(aggregateArgs._sum).toEqual({ missingAssetCount: true });
    expect(aggregateArgs.where.completedAt).toEqual({ not: null });

    const missingKpi = result.kpis.find((k) => k.id === "assets_missing");
    expect(missingKpi?.rawValue).toBe(7);
    expect(missingKpi?.value).toBe("7");
  });

  it("computes per-row accuracy as found/expected and leaves it null when expected is 0", async () => {
    vi.mocked(db.auditSession.findMany).mockResolvedValue([
      makeSession({
        id: "audit-1",
        expectedAssetCount: 10,
        foundAssetCount: 8,
      }),
      makeSession({
        id: "audit-empty-scope",
        expectedAssetCount: 0,
        foundAssetCount: 0,
      }),
    ] as never);
    stubCounts({ windowTotal: 2, total: 2, completed: 2 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].accuracy).toBe(80);
    // 0 expected assets means there is nothing to be accurate against —
    // null, not 0%, so the UI renders "—" instead of a failing score.
    expect(result.rows[1].accuracy).toBeNull();
  });

  it("resolves createdByName through displayName", async () => {
    vi.mocked(db.auditSession.findMany).mockResolvedValue([
      makeSession({
        createdBy: { firstName: "Jane", lastName: "Doe", displayName: "JD" },
      }),
    ] as never);
    stubCounts({ windowTotal: 1, total: 1, completed: 1 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].createdByName).toBe("JD");
  });

  it("returns a null completion rate rendered as an em dash when there are no sessions", async () => {
    stubCounts({ windowTotal: 0, total: 0, completed: 0, overdue: 0 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const rateKpi = result.kpis.find((k) => k.id === "completion_rate");
    expect(rateKpi?.value).toBe("—");
    expect(rateKpi?.rawValue).toBeUndefined();
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it("computes the completion rate from completed/total when sessions exist", async () => {
    stubCounts({ windowTotal: 5, total: 4, completed: 3, overdue: 1 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const byId = (id: string) => result.kpis.find((k) => k.id === id);
    expect(byId("total_audits")?.rawValue).toBe(4);
    expect(byId("completed_audits")?.rawValue).toBe(3);
    expect(byId("completion_rate")?.value).toBe("75%");
    expect(byId("completion_rate")?.rawValue).toBe(75);
    expect(byId("overdue_audits")?.rawValue).toBe(1);
  });

  it("paginates at the database and orders by createdAt desc with an id tiebreaker", async () => {
    stubCounts({ windowTotal: 120 });

    const result = await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
      page: 3,
      pageSize: 20,
    });

    const findManyArgs = vi.mocked(db.auditSession.findMany).mock
      .calls[0][0] as {
      skip: number;
      take: number;
      orderBy: unknown;
    };
    expect(findManyArgs.skip).toBe(40);
    expect(findManyArgs.take).toBe(20);
    expect(findManyArgs.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "asc" },
    ]);
    expect(result.totalRows).toBe(120);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(20);
  });

  it("scopes every query to the organization and the createdAt window", async () => {
    await auditCompletionReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const window = { gte: TIMEFRAME.from, lte: TIMEFRAME.to };

    const findManyWhere = (
      vi.mocked(db.auditSession.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(findManyWhere.organizationId).toBe("org-1");
    expect(findManyWhere.createdAt).toEqual(window);

    for (const [args] of vi.mocked(db.auditSession.count).mock.calls) {
      const where = (args as { where: Record<string, unknown> }).where;
      expect(where.organizationId).toBe("org-1");
      expect(where.createdAt).toEqual(window);
    }

    const aggregateWhere = (
      vi.mocked(db.auditSession.aggregate).mock.calls[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(aggregateWhere.organizationId).toBe("org-1");
    expect(aggregateWhere.createdAt).toEqual(window);
  });
});
