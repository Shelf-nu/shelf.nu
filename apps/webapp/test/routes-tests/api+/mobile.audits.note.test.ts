/**
 * Test suite for POST /api/mobile/audits/note.
 * Covers condition-note creation scoped to an auditAsset, the cross-tenant
 * guard, the paid Audits add-on enforcement (403), permission checks, and
 * invalid-body handling.
 */
import { action } from "~/routes/api+/mobile+/audits.note";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() to return Response objects (RR v7 single fetch)
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth — don't hit Supabase. Includes requireMobileAuditsEnabled
// (the #18 paid-add-on guard) so we can assert it gates this route.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobileAuditsEnabled: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: external service — assignee scoping is enforced here
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssignee: vi.fn(),
}));

// why: external database — don't hit the real DB
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    auditAsset: { findFirst: vi.fn() },
    auditNote: { create: vi.fn() },
  },
}));

// why: control error formatting in the catch block
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobileAuditsEnabled,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createNoteRequest(body: Record<string, unknown>, orgId = "org-1") {
  return new Request(`http://localhost/api/mobile/audits/note?orgId=${orgId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  auditSessionId: "session-1",
  auditAssetId: "audit-asset-1",
  content: "Scratched on the left side",
};

describe("POST /api/mobile/audits/note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobileAuditsEnabled as any).mockResolvedValue(undefined);
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });
    (db.auditAsset.findFirst as any).mockResolvedValue({
      id: "audit-asset-1",
    });
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (requireAuditAssignee as any).mockResolvedValue(undefined);
  });

  it("creates a condition note scoped to the auditAsset and returns it", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });
    (db.auditNote.create as any).mockResolvedValue({
      id: "note-1",
      content: "Scratched on the left side",
      user: { id: "user-1", firstName: "Test", lastName: "User" },
    });

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.note.id).toBe("note-1");
    expect(db.auditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "Scratched on the left side",
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          userId: "user-1",
        }),
      })
    );
  });

  it("returns 403 when the workspace lacks the Audits add-on (revenue bypass closed)", async () => {
    const addonErr = new Error("Audit functionality is not enabled");
    (addonErr as any).status = 403;
    (requireMobileAuditsEnabled as any).mockRejectedValue(addonErr);

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks audit:update permission", async () => {
    const permErr = new Error("Permission denied");
    (permErr as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permErr);

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the audit session is not in the caller's org", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue(null);

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect((result as unknown as Response).status).toBe(404);
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });

  it("returns 404 when auditAssetId is not in the session (cross-tenant guard)", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });
    (db.auditAsset.findFirst as any).mockResolvedValue(null); // belongs elsewhere

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect((result as unknown as Response).status).toBe(404);
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an assignee of the audit", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });
    const assigneeErr = new Error("Not an assignee");
    (assigneeErr as any).status = 403;
    (requireAuditAssignee as any).mockRejectedValue(assigneeErr);

    const result = await action(
      createActionArgs({ request: createNoteRequest(validBody) })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(requireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        organizationId: "org-1",
        userId: "user-1",
        isSelfServiceOrBase: true,
      })
    );
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });

  it("rejects an empty/invalid body without creating a note", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });

    const result = await action(
      createActionArgs({
        request: createNoteRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          content: "",
        }),
      })
    );

    expect((result as unknown as Response).status).toBeGreaterThanOrEqual(400);
    expect(db.auditNote.create).not.toHaveBeenCalled();
  });
});
