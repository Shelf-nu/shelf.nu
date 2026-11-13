/**
 * Audit detail loader: who may open an audit, and who may manage it.
 *
 * Opening an unassigned audit needs `audits.seeAll`; managing someone else's
 * audit (cancel, archive, delete) needs `audits.manageOthers`. Both come from
 * the effective role, whatever order the membership lists its roles in.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 */
import type { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import {
  getAuditSessionDetails,
  getAuditUnitTotals,
} from "~/modules/audit/service.server";
import { db } from "~/database/db.server";
import { loader } from "~/routes/_layout+/audits.$auditId";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the permission gate is exercised elsewhere; this test feeds the access
// it returns for each membership
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the audit session read is database work; the session below, assigned
// to someone other than the caller, is the input
vi.mock("~/modules/audit/service.server", () => ({
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
  getAuditSessionDetails: vi.fn(),
  // why: the units line of the Complete Audit dialog is a database read; this
  // audit has no quantity-tracked rows
  getAuditUnitTotals: vi.fn(async () => null),
}));

// why: the route imports completeAuditWithImages for an action intent; stub
// the module so the import graph loads under the node environment
vi.mock("~/modules/audit/complete-audit-with-images.server", () => ({
  completeAuditWithImages: vi.fn(),
}));

// why: scan counts and team members are database reads the loader performs
vi.mock("~/database/db.server", () => ({
  db: {
    auditScan: { count: vi.fn(async () => 0) },
    teamMember: { findMany: vi.fn(async () => []) },
  },
}));

/** An ACTIVE audit created by and assigned to someone other than the caller. */
const SESSION = {
  id: "audit-1",
  name: "Audit",
  description: null,
  createdById: "someone-else",
  status: "ACTIVE",
  assignments: [{ userId: "someone-else" }],
  expectedAssetCount: 0,
  foundAssetCount: 0,
  missingAssetCount: 0,
  unexpectedAssetCount: 0,
};

const context = {
  getSession: () => ({ userId: "caller" }),
} as unknown as Parameters<typeof loader>[0]["context"];

/**
 * Runs the loader as a member holding `roles` and reports the HTTP status,
 * plus the payload when it succeeds.
 */
async function load(roles: OrganizationRoles[]) {
  vi.mocked(requirePermission).mockResolvedValue(
    permissionContext({ roles }) as unknown as Awaited<
      ReturnType<typeof requirePermission>
    >
  );
  try {
    const res = await loader(
      createLoaderArgs({ params: { auditId: "audit-1" }, context })
    );
    return {
      status: 200,
      data: (res as unknown as { data: Record<string, unknown> }).data,
    };
  } catch (e) {
    return { status: (e as { init?: { status?: number } }).init?.status };
  }
}

describe("audits.$auditId loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditSessionDetails).mockResolvedValue({
      session: SESSION,
    } as unknown as Awaited<ReturnType<typeof getAuditSessionDetails>>);
  });

  it.each<[OrganizationRoles[]]>([
    [["ADMIN"]],
    [["OWNER"]],
    [["SELF_SERVICE", "ADMIN"]],
  ])("%j opens an unassigned audit and may manage it", async (roles) => {
    const r = await load(roles);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      canSeeAllAudits: true,
      canManageOthersAudits: true,
    });
  });

  it.each<[OrganizationRoles[]]>([
    [["SELF_SERVICE"]],
    [["BASE"]],
    [["BASE", "SELF_SERVICE"]],
  ])("%j may not open an audit it is not assigned to", async (roles) => {
    expect((await load(roles)).status).toBe(403);
  });
});

describe("audits.$auditId loader, unit totals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditSessionDetails).mockResolvedValue({
      session: SESSION,
    } as unknown as Awaited<ReturnType<typeof getAuditSessionDetails>>);
  });

  it("hands the audit's unit totals to the page (the header dialog and the overview read them)", async () => {
    const totals = {
      quantityRows: 1,
      expectedUnits: 14,
      foundUnits: 8,
      uncountedRows: 0,
      unexpectedRows: 0,
      unexpectedUnits: 0,
      unexpectedUncountedRows: 0,
    };
    vi.mocked(getAuditUnitTotals).mockResolvedValue(totals);

    const r = await load(["ADMIN"]);

    expect(r.status).toBe(200);
    expect(getAuditUnitTotals).toHaveBeenCalledWith("audit-1");
    expect(r.data).toMatchObject({ unitTotals: totals });
  });

  it("does not read the totals for a caller refused the audit", async () => {
    expect((await load(["BASE"])).status).toBe(403);
    expect(getAuditUnitTotals).not.toHaveBeenCalled();
  });
});

describe("audits.$auditId loader, assignment roster", () => {
  const ROSTER = [{ id: "tm-1", name: "Ann", userId: "user-ann" }];

  beforeEach(() => {
    vi.clearAllMocks();
    // The caller is the assignee, so every role may open the audit.
    vi.mocked(getAuditSessionDetails).mockResolvedValue({
      session: { ...SESSION, assignments: [{ userId: "caller" }] },
    } as unknown as Awaited<ReturnType<typeof getAuditSessionDetails>>);
    vi.mocked(db.teamMember.findMany).mockResolvedValue(
      ROSTER as unknown as Awaited<ReturnType<typeof db.teamMember.findMany>>
    );
  });

  it("sends the workspace roster to a caller who manages others' audits", async () => {
    const r = await load(["ADMIN"]);

    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ teamMembers: ROSTER });
  });

  it.each<[OrganizationRoles[]]>([[["SELF_SERVICE"]], [["BASE"]]])(
    "sends %j an empty roster and does not read it",
    async (roles) => {
      const r = await load(roles);

      expect(r.status).toBe(200);
      expect(r.data).toMatchObject({ teamMembers: [] });
      expect(db.teamMember.findMany).not.toHaveBeenCalled();
    }
  );
});
