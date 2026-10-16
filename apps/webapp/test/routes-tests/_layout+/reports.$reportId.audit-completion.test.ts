/**
 * Report page loader: the Audit Completion report is scoped to the caller's
 * audit reach.
 *
 * A caller who cannot see every audit (`access.audits.seeAll` false) must get
 * only the audits assigned to them, the same reach the audits index applies.
 * The CSV export carries the same scoping; its test lives beside the export
 * route's.
 *
 * @see {@link file://../../../app/routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://../../../app/modules/reports/audit-completion.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { auditCompletionReport } from "~/modules/reports/audit-completion.server";
import { loader } from "~/routes/_layout+/reports.$reportId";
import { requirePermission } from "~/utils/roles.server";

// why: the caller's reach is expressed by what the permission check returns;
// the real check reads the caller's membership from the database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the report builder queries Prisma; these tests assert only the
// arguments the loader hands it.
vi.mock("~/modules/reports/audit-completion.server", () => ({
  auditCompletionReport: vi.fn(),
}));

// why: format prefs are resolved from the database for the acting user
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(() =>
    Promise.resolve({
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      timeZone: "UTC",
      weekStartsOn: 0,
    })
  ),
}));

/** Signs the caller in with the given audit reach. */
function signInWithAuditReach(seeAll: boolean) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    currentOrganization: { currency: "USD" },
    access: { audits: { seeAll } },
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

/** Runs the loader for the Audit Completion report, page 2. */
function loadAuditReport() {
  return loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost/reports/audit-completion?page=2&pageSize=25"
      ),
      params: { reportId: "audit-completion" },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as never)
  );
}

describe("audit-completion report loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auditCompletionReport).mockResolvedValue({
      report: {
        id: "audit-completion",
        title: "Audit Completion",
        description: "",
      },
      filters: {
        timeframe: {
          preset: "last_30d",
          from: new Date("2026-07-25T00:00:00.000Z"),
          to: new Date("2026-08-24T00:00:00.000Z"),
          label: "Last 30 days",
        },
        filters: [],
      },
      kpis: [],
      rows: [],
      computedMs: 0,
      totalRows: 0,
      page: 2,
      pageSize: 25,
    });
  });

  it("limits the report to assigned audits when the caller cannot see every audit", async () => {
    signInWithAuditReach(false);

    await loadAuditReport();

    expect(auditCompletionReport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        assignedOnly: true,
        page: 2,
        pageSize: 25,
      })
    );
  });

  it("applies no assignment limit when the caller sees every audit", async () => {
    signInWithAuditReach(true);

    await loadAuditReport();

    expect(auditCompletionReport).toHaveBeenCalledWith(
      expect.objectContaining({ assignedOnly: false })
    );
  });
});
