/**
 * Mobile audit READ routes are permission-gated.
 *
 * The list, detail and evidence routes require `audit:read` before they read
 * anything. A membership without it is refused and no audit data is fetched.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/audits.ts}
 * @see {@link file://../../../app/routes/api+/mobile+/audits.$auditId.ts}
 * @see {@link file://../../../app/routes/api+/mobile+/audits.$auditId.evidence.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

// @vitest-environment node

const refuse = vi.hoisted(() => ({ on: false }));

// why: token auth needs Supabase; the permission gate is the unit under test,
// so requireMobilePermission refuses when a case switches `refuse.on`
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const { ShelfError } = await import("~/utils/error");
  return {
    requireMobileAuth: vi.fn(async () => ({ user: { id: "caller" } })),
    requireOrganizationAccess: vi.fn(async () => "org-1"),
    getMobileUserContext: vi.fn(),
    requireMobilePermission: vi.fn(async () => {
      if (refuse.on) {
        throw new ShelfError({
          cause: null,
          message: "You have no permission to perform this action",
          status: 403,
          label: "Permission",
          shouldBeCaptured: false,
        });
      }
    }),
  };
});

// why: every audit read is database work; the assertions check none ran
vi.mock("~/modules/audit/service.server", () => ({
  getAuditsForOrganization: vi.fn(async () => ({ audits: [], totalAudits: 0 })),
  getAuditSessionDetails: vi.fn(),
  getAuditScans: vi.fn(async () => []),
  requireAuditAssignee: vi.fn(async () => undefined),
}));

// why: the evidence route reads the database directly
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn(async () => ({ id: "audit-1" })) },
    auditNote: { findMany: vi.fn(async () => []) },
    auditImage: { findMany: vi.fn(async () => []) },
  },
}));

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import {
  getAuditSessionDetails,
  getAuditsForOrganization,
} from "~/modules/audit/service.server";
import { loader as listLoader } from "~/routes/api+/mobile+/audits";
import { loader as detailLoader } from "~/routes/api+/mobile+/audits.$auditId";
import { loader as evidenceLoader } from "~/routes/api+/mobile+/audits.$auditId.evidence";

const req = (path: string) =>
  new Request(`http://localhost/api/mobile/${path}?orgId=org-1`, {
    headers: { Authorization: "Bearer t" },
  });

/**
 * The HTTP status a loader answered with. The routes return `data(...)` for
 * refusals (status on `init`); anything thrown carries it the same way.
 */
const statusOf = async (p: Promise<unknown>) => {
  try {
    const res = (await p) as { init?: { status?: number }; status?: number };
    return res.init?.status ?? res.status ?? 200;
  } catch (e) {
    return (e as { init?: { status?: number } }).init?.status;
  }
};

describe.each([
  [
    "list",
    () =>
      listLoader({ request: req("audits"), params: {}, context: {} } as never),
    getAuditsForOrganization,
  ],
  [
    "detail",
    () =>
      detailLoader({
        request: req("audits/audit-1"),
        params: { auditId: "audit-1" },
        context: {},
      } as never),
    getAuditSessionDetails,
  ],
  [
    "evidence",
    () =>
      evidenceLoader({
        request: req("audits/audit-1/evidence"),
        params: { auditId: "audit-1" },
        context: {},
      } as never),
    db.auditNote.findMany,
  ],
])("mobile audit %s", (_name, run, read) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["BASE"] }) as never
    );
  });

  it("requires audit:read", async () => {
    refuse.on = false;
    await statusOf(run());
    expect(requireMobilePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.audit,
        action: PermissionAction.read,
      })
    );
  });

  it("refuses without audit:read and reads nothing", async () => {
    refuse.on = true;
    expect(await statusOf(run())).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
});
