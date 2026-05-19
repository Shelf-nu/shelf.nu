/**
 * Test suite for requireAuditAssetInSession — the shared cross-tenant +
 * assignee guard for the mobile audit-evidence routes.
 */
// @vitest-environment node

// why: external database — don't hit the real DB
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    auditAsset: { findFirst: vi.fn() },
  },
}));

// why: external auth — role lookup hits Supabase-backed membership
vi.mock("~/modules/api/mobile-auth.server", () => ({
  getMobileUserContext: vi.fn(),
}));

// why: assignee scoping is the unit under test's delegated guard
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssignee: vi.fn(),
}));

import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { requireAuditAssetInSession } from "~/modules/audit/mobile-evidence.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";

const args = {
  auditSessionId: "session-1",
  auditAssetId: "audit-asset-1",
  organizationId: "org-1",
  userId: "user-1",
};

describe("requireAuditAssetInSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });
    (db.auditAsset.findFirst as any).mockResolvedValue({ id: "audit-asset-1" });
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (requireAuditAssignee as any).mockResolvedValue(undefined);
  });

  it("resolves when session+asset+assignee all pass", async () => {
    await expect(requireAuditAssetInSession(args)).resolves.toBeUndefined();
    expect(db.auditSession.findFirst).toHaveBeenCalledWith({
      where: { id: "session-1", organizationId: "org-1" },
      select: { id: true },
    });
    expect(db.auditAsset.findFirst).toHaveBeenCalledWith({
      where: { id: "audit-asset-1", auditSessionId: "session-1" },
      select: { id: true },
    });
  });

  it("throws 404 when the session is not in the caller's org", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue(null);
    await expect(requireAuditAssetInSession(args)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("throws 404 when the asset is not in the session (cross-tenant)", async () => {
    (db.auditAsset.findFirst as any).mockResolvedValue(null);
    await expect(requireAuditAssetInSession(args)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("passes isSelfServiceOrBase=true to the assignee guard for BASE", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "BASE" });
    await requireAuditAssetInSession(args);
    expect(requireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        organizationId: "org-1",
        userId: "user-1",
        isSelfServiceOrBase: true,
      })
    );
  });

  it("propagates the assignee guard rejection", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });
    const err = Object.assign(new Error("Not an assignee"), { status: 403 });
    (requireAuditAssignee as any).mockRejectedValue(err);
    await expect(requireAuditAssetInSession(args)).rejects.toMatchObject({
      status: 403,
    });
  });
});
