/**
 * Plan gate on every reports door.
 *
 * Reports are part of the Plus and Team plans. Four routes hand out report
 * data, and each must refuse a workspace whose plan does not include them:
 *
 * | Door            | Free workspace gets                          |
 * | --------------- | -------------------------------------------- |
 * | reports index   | the unlock page payload, no report data      |
 * | a report page   | a redirect to the index (the unlock page)    |
 * | CSV export      | 403 with the plan copy                       |
 * | PDF data        | 403 with the plan copy                       |
 *
 * The plan is the WORKSPACE's: its owner's tier, never the viewer's own. So the
 * database stand-in answers by user id, and the cases prove whose tier is read.
 * The role check runs for real and comes first, so a role that may not see
 * reports keeps its role error whatever the plan.
 *
 * The manifest test reads the route files from disk: a new route that names
 * `PermissionEntity.reports` fails this suite until it joins `DOORS`, which is
 * what keeps a fifth door from shipping without the gate.
 *
 * @see {@link file://../../app/utils/subscription.server.ts} `workspaceCanUseReports`
 * @see {@link file://../../app/modules/reports/plan-copy.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import {
  assetInventoryReport,
  resolveTimeframe,
} from "~/modules/reports/helpers.server";
import { getEnabledReports } from "~/modules/reports/registry";
import type { ReportPayload } from "~/modules/reports/types";
import { loader as pdfLoader } from "~/routes/api+/reports.$reportId.generate-pdf";
import { loader as reportLoader } from "~/routes/_layout+/reports.$reportId";
import { loader as indexLoader } from "~/routes/_layout+/reports._index";
import { loader as csvLoader } from "~/routes/_layout+/reports.export.$fileName[.csv]";

// why: the tier, custom tier and organization rows live in the database; the
// stand-in answers by user id so the cases can prove whose tier is read
vi.mock("~/database/db.server", () => ({
  db: {
    user: { findUniqueOrThrow: vi.fn() },
    customTierLimit: { findUniqueOrThrow: vi.fn() },
    organization: { findUnique: vi.fn() },
    userOrganization: { findFirst: vi.fn() },
  },
}));

// why: the selected workspace comes from the session cookie and a membership
// query; everything after it (the role matrix, the owner check) runs for real
vi.mock("~/modules/organization/context.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/organization/context.server")
  >()),
  getSelectedOrganization: vi.fn(),
}));

// why: the report builders run Prisma queries; the gate only decides whether
// they are reached
vi.mock("~/modules/reports/helpers.server", () => ({
  resolveTimeframe: vi.fn(),
  bookingComplianceReport: vi.fn(),
  overdueItemsReport: vi.fn(),
  idleAssetsReport: vi.fn(),
  custodySnapshotReport: vi.fn(),
  topBookedAssetsReport: vi.fn(),
  topBookedKitsReport: vi.fn(),
  assetDistributionReport: vi.fn(),
  assetInventoryReport: vi.fn(),
  monthlyBookingTrendsReport: vi.fn(),
  assetUtilizationReport: vi.fn(),
  assetActivityReport: vi.fn(),
}));

// why: format prefs are resolved from the database for the acting user
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(() =>
    Promise.resolve({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      timeZone: "UTC",
      weekStartsOn: 0,
    })
  ),
}));

const PLAN_TITLE = "Reports are part of Plus and Team";
const PLAN_MESSAGE =
  "Upgrade this workspace to open reports. Your assets and their data stay available on every plan.";

/** The workspace owner, whose tier is the workspace's plan. */
const OWNER_ID = "owner-1";
/** An administrator in the owner's workspace, on a Free account of their own. */
const ADMIN_ID = "admin-1";
const ORG_ID = "org-1";

type PlanId = "free" | "tier_1" | "tier_2" | "custom" | "custom-off";

/** The tier row `getUserTierLimit` reads for a user on `plan`. */
function tierRow(plan: PlanId) {
  if (plan === "custom" || plan === "custom-off") {
    // A custom tier carries its limits on `CustomTierLimit`, read separately.
    return { tier: { id: "custom", tierLimit: null } };
  }
  return {
    tier: {
      id: plan,
      tierLimit: {
        id: plan,
        canImportAssets: plan !== "free",
        canExportAssets: plan !== "free",
        canImportNRM: plan !== "free",
        canHideShelfBranding: plan !== "free",
        canUseReports: plan !== "free",
        maxCustomFields: plan === "free" ? 0 : 100,
        maxOrganizations: 1,
      },
    },
  };
}

/**
 * Points the database stand-in at a world where the workspace owner is on
 * `ownerPlan` and every other user is on Free.
 */
function givenOwnerPlan(ownerPlan: PlanId) {
  vi.mocked(db.user.findUniqueOrThrow).mockImplementation((async (args: {
    where: { id: string };
  }) => tierRow(args.where.id === OWNER_ID ? ownerPlan : "free")) as never);
  vi.mocked(db.customTierLimit.findUniqueOrThrow).mockResolvedValue({
    canUseReports: ownerPlan !== "custom-off",
  } as never);
}

/** Signs `userId` into the owner's workspace with `role`. */
function givenViewer(userId: string, role: OrganizationRoles) {
  const organization = {
    id: ORG_ID,
    type: "TEAM" as const,
    name: "Workspace",
    imageId: null,
    userId: OWNER_ID,
    currency: "USD",
  };
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: ORG_ID,
    organizations: [organization],
    currentOrganization: organization,
    userOrganizations: [{ organization: { id: ORG_ID }, roles: [role] }],
  } as never);
  return {
    getSession: () => ({ userId }),
  } as unknown as LoaderFunctionArgs["context"];
}

/** An empty report, enough for every door to finish on a plan with reports. */
const emptyInventory: ReportPayload<never> = {
  report: {
    id: "asset-inventory",
    title: "Asset Inventory",
    description: "",
  },
  filters: {
    timeframe: {
      preset: "last_30d",
      from: new Date("2026-08-31T00:00:00.000Z"),
      to: new Date("2026-09-30T00:00:00.000Z"),
      label: "Last 30 days",
    },
    filters: [],
  },
  kpis: [],
  rows: [],
  computedMs: 0,
  totalRows: 0,
  page: 1,
  pageSize: 50,
};

/** What a door answered, reduced to the part these tests are about. */
type Outcome =
  | { kind: "report-data" }
  | { kind: "unlock-page"; isOwner: boolean; reportTitles: string[] }
  | { kind: "redirect"; location: string | null }
  | { kind: "refused"; status: number; title?: string; message?: string };

/** `data()` from react-router: a value plus the response init. */
type DataWithInit = {
  data: Record<string, unknown>;
  init?: { status?: number } | null;
};

/** Whether a loader result is a react-router `data()` value rather than a raw Response. */
function isDataWithInit(value: unknown): value is DataWithInit {
  return typeof value === "object" && value !== null && "data" in value;
}

/** Reads whatever a loader returned or threw as an {@link Outcome}. */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  let result: unknown;
  try {
    result = await run();
  } catch (thrown) {
    result = thrown;
  }

  if (result instanceof Response) {
    if (result.status >= 300 && result.status < 400) {
      return { kind: "redirect", location: result.headers.get("Location") };
    }
    // Only the CSV door answers with a raw Response, and only for a file.
    return result.status === 200
      ? { kind: "report-data" }
      : { kind: "refused", status: result.status };
  }

  if (!isDataWithInit(result)) {
    throw new Error(`Unexpected loader result: ${String(result)}`);
  }

  const status = result.init?.status ?? 200;
  const body = result.data;

  if (status >= 400) {
    const error = body.error as { title?: string; message?: string };
    return {
      kind: "refused",
      status,
      title: error.title,
      message: error.message,
    };
  }

  if (body.canUseReports === false) {
    return {
      kind: "unlock-page",
      isOwner: body.isOwner as boolean,
      reportTitles: (body.reports as { title: string }[]).map((r) => r.title),
    };
  }

  return { kind: "report-data" };
}

/** One route that hands out report data. */
type Door = {
  /** Route file, relative to `app/routes`. */
  file: string;
  /** Calls the route's loader as `context`'s user would. */
  run: (context: LoaderFunctionArgs["context"]) => Promise<unknown>;
  /** What a workspace without reports gets from this door. */
  lockedOutcome: Outcome;
};

const DOORS: Door[] = [
  {
    file: "_layout+/reports._index.tsx",
    run: (context) =>
      indexLoader(
        createLoaderArgs({
          request: new Request("http://localhost:3000/reports"),
          context,
        })
      ),
    lockedOutcome: {
      kind: "unlock-page",
      isOwner: true,
      reportTitles: getEnabledReports().map((r) => r.title),
    },
  },
  {
    file: "_layout+/reports.$reportId.tsx",
    run: (context) =>
      reportLoader(
        createLoaderArgs({
          request: new Request("http://localhost:3000/reports/asset-inventory"),
          params: { reportId: "asset-inventory" },
          context,
        })
      ),
    lockedOutcome: { kind: "redirect", location: "/reports" },
  },
  {
    file: "_layout+/reports.export.$fileName[.csv].tsx",
    run: (context) =>
      csvLoader(
        createLoaderArgs({
          request: new Request(
            "http://localhost:3000/reports/export/inventory.csv?reportId=asset-inventory"
          ),
          params: { fileName: "inventory" },
          context,
        })
      ),
    lockedOutcome: {
      kind: "refused",
      status: 403,
      title: PLAN_TITLE,
      message: PLAN_MESSAGE,
    },
  },
  {
    file: "api+/reports.$reportId.generate-pdf.tsx",
    run: (context) =>
      pdfLoader(
        createLoaderArgs({
          request: new Request(
            "http://localhost:3000/api/reports/asset-inventory/generate-pdf"
          ),
          params: { reportId: "asset-inventory" },
          context,
        })
      ),
    lockedOutcome: {
      kind: "refused",
      status: 403,
      title: PLAN_TITLE,
      message: PLAN_MESSAGE,
    },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTimeframe).mockReturnValue(emptyInventory.filters.timeframe);
  vi.mocked(assetInventoryReport).mockResolvedValue(emptyInventory);
  vi.mocked(db.organization.findUnique).mockResolvedValue({
    name: "Workspace",
    imageId: null,
    updatedAt: new Date("2026-09-30T00:00:00.000Z"),
    currency: "USD",
  } as never);
});

describe("reports plan gate: manifest", () => {
  const ROUTES_DIR = path.resolve(__dirname, "../../app/routes");

  it("covers every route that names the reports permission", () => {
    const reportRoutes = readdirSync(ROUTES_DIR, { recursive: true })
      .map((entry) => String(entry))
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."))
      .filter((file) =>
        readFileSync(path.join(ROUTES_DIR, file), "utf8").includes(
          "PermissionEntity.reports"
        )
      )
      .sort();

    expect(reportRoutes).toEqual(DOORS.map((door) => door.file).sort());
  });
});

describe("reports plan gate: a workspace on the Free plan", () => {
  it.each(DOORS)("$file keeps the report data back", async (door) => {
    givenOwnerPlan("free");
    const context = givenViewer(OWNER_ID, OrganizationRoles.OWNER);

    expect(await outcomeOf(() => door.run(context))).toEqual(
      door.lockedOutcome
    );
    expect(assetInventoryReport).not.toHaveBeenCalled();
  });

  it("shows an administrator the unlock page without the upgrade", async () => {
    givenOwnerPlan("free");
    const context = givenViewer(ADMIN_ID, OrganizationRoles.ADMIN);

    // Only the owner's plan decides what the workspace has.
    expect(await outcomeOf(() => DOORS[0].run(context))).toMatchObject({
      kind: "unlock-page",
      isOwner: false,
    });
  });

  it("keeps the report data back on a custom plan with reports switched off", async () => {
    givenOwnerPlan("custom-off");
    const context = givenViewer(OWNER_ID, OrganizationRoles.OWNER);

    for (const door of DOORS) {
      expect(await outcomeOf(() => door.run(context))).toEqual(
        door.lockedOutcome
      );
    }
  });
});

describe("reports plan gate: a workspace on a plan with reports", () => {
  const cases = DOORS.flatMap((door) =>
    (["tier_1", "tier_2", "custom"] as const).map((plan) => ({
      ...door,
      plan,
    }))
  );

  it.each(cases)("$file serves the reports on $plan", async (door) => {
    givenOwnerPlan(door.plan);
    const context = givenViewer(OWNER_ID, OrganizationRoles.OWNER);

    expect(await outcomeOf(() => door.run(context))).toEqual({
      kind: "report-data",
    });
  });

  it.each(DOORS)(
    "$file reads the owner's plan, not the viewer's",
    async (door) => {
      // The administrator's own account is Free; the workspace is on Team.
      givenOwnerPlan("tier_2");
      const context = givenViewer(ADMIN_ID, OrganizationRoles.ADMIN);

      expect(await outcomeOf(() => door.run(context))).toEqual({
        kind: "report-data",
      });
      expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OWNER_ID } })
      );
      expect(db.user.findUniqueOrThrow).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ADMIN_ID } })
      );
    }
  );
});

describe("reports plan gate: the role check comes first", () => {
  it.each(DOORS)(
    "$file gives a base user the role error, whatever the plan",
    async (door) => {
      givenOwnerPlan("free");
      const context = givenViewer("base-1", OrganizationRoles.BASE);

      expect(await outcomeOf(() => door.run(context))).toMatchObject({
        kind: "refused",
        status: 403,
        title: "Unauthorized",
      });
      // The plan is never looked up for a role that may not see reports.
      expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
    }
  );
});
