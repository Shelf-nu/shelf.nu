// @vitest-environment node
/**
 * Audit overview action — which intents sit behind the assignment guard.
 *
 * The guard is hoisted ahead of the intent branches so a newly added intent
 * inherits it (fail-closed) rather than silently escaping it. That is right
 * for every intent EXCEPT `cancel-audit`, whose own rule is broader:
 * `createAuditSession` does not auto-assign the creator, and
 * `cancelAuditSession` guarantees the creator may always cancel. Gating cancel
 * on assignment would lock a BASE creator out of an audit they made.
 *
 * Both directions are pinned here, because getting either wrong is invisible
 * to typecheck and to every other test.
 *
 * detail.dev D101; the cancel exemption was caught in review on #2900.
 *
 * @see {@link file://./../../../app/routes/_layout+/audits.$auditId.overview.tsx}
 */

import { OrganizationRoles } from "@prisma/client";

// why: React Router v7 single fetch — `data()`/`redirect()` must return real
// Responses so the action's paths can be exercised without a router.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), { status: init?.status || 200 })
    ),
    redirect: vi.fn(
      (url: string) =>
        new Response(null, {
          status: 302,
          headers: { Location: url },
        })
    ),
  };
});

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate must PASS, so a refusal proves the ASSIGNMENT check is
// what refused rather than the permission check.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const mocks = vi.hoisted(() => ({
  requireAuditAssignee: vi.fn(),
  cancelAuditSession: vi.fn().mockResolvedValue({}),
  removeAssetFromAudit: vi.fn().mockResolvedValue(undefined),
  removeAssetsFromAudit: vi.fn().mockResolvedValue({ removedCount: 1 }),
}));
// why: the guard and the mutations all hit the database. Mocking them lets a
// test choose "assigned" vs "not assigned" and assert on the sinks.
vi.mock("~/modules/audit/service.server", () => ({
  ...mocks,
  getAuditSessionDetails: vi.fn(),
  getAssetsForAuditSession: vi.fn(),
  requireAuditAssigneeForBaseSelfService: vi.fn(),
}));
vi.mock("~/modules/audit/complete-audit-with-images.server", () => ({
  completeAuditWithImages: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/modules/audit/image.service.server", () => ({
  getAuditImages: vi.fn().mockResolvedValue([]),
}));
// why: the bulk branch resolves auditAssetIds through Prisma before calling
// the service; irrelevant to which intents are guarded.
vi.mock("~/database/db.server", () => ({
  db: { auditAsset: { findMany: vi.fn().mockResolvedValue([{ id: "aa-1" }]) } },
}));

import { action } from "~/routes/_layout+/audits.$auditId.overview";

const AUDIT_ID = "audit-1";

/** The 403 `requireAuditAssignee` throws for a non-assignee. */
function notAnAssignee() {
  const err = new Error("You don't have permission to view this audit");
  Object.assign(err, { status: 403, isShelfError: true });
  return err;
}

function post(body: Record<string, string>) {
  return action({
    request: new Request(`https://app.shelf.nu/audits/${AUDIT_ID}/overview`, {
      method: "POST",
      body: new URLSearchParams(body),
    }),
    params: { auditId: AUDIT_ID },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof action>[0]);
}

describe("audit overview intent guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelAuditSession.mockResolvedValue({});
    mocks.removeAssetFromAudit.mockResolvedValue(undefined);
    mocks.removeAssetsFromAudit.mockResolvedValue({ removedCount: 1 });
    mockRequirePermission.mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
      role: OrganizationRoles.BASE,
    });
  });

  describe("guarded by assignment", () => {
    beforeEach(() => {
      mocks.requireAuditAssignee.mockRejectedValue(notAnAssignee());
    });

    it("refuses remove-asset from an unassigned member", async () => {
      await post({ intent: "remove-asset", auditAssetId: "aa-1" });
      expect(mocks.removeAssetFromAudit).not.toHaveBeenCalled();
    });

    it("refuses bulk-remove-assets from an unassigned member", async () => {
      await post({ intent: "bulk-remove-assets", "assetIds[0]": "asset-1" });
      expect(mocks.removeAssetsFromAudit).not.toHaveBeenCalled();
    });

    it("guards an UNKNOWN intent too, so a new one cannot escape by default", async () => {
      // The reason the guard is an exclusion rather than an allowlist. If this
      // ever fails, someone inverted it and new intents ship unguarded.
      await post({ intent: "some-future-intent" });
      expect(mocks.requireAuditAssignee).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancel-audit — its own rule is broader", () => {
    it("reaches the service even when the caller is not an assignee", async () => {
      mocks.requireAuditAssignee.mockRejectedValue(notAnAssignee());

      await post({ intent: "cancel-audit" });

      // The creator of an audit is never auto-assigned to it, so gating this
      // on assignment would lock a BASE creator out of their own audit.
      // `cancelAuditSession` applies creator-or-admin itself.
      expect(mocks.cancelAuditSession).toHaveBeenCalledTimes(1);
      expect(mocks.requireAuditAssignee).not.toHaveBeenCalled();
    });

    it("forwards isAdminOrOwner so the service can apply its own rule", async () => {
      mocks.requireAuditAssignee.mockResolvedValue(undefined);

      await post({ intent: "cancel-audit" });

      expect(mocks.cancelAuditSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", isAdminOrOwner: false })
      );
    });
  });
});
