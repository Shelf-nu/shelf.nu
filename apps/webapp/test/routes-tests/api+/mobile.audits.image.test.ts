/**
 * Test suite for POST /api/mobile/audits/image.
 * Covers condition-photo upload + matching note (default vs content),
 * Markdoc-injection stripping, the cross-tenant guard, the paid Audits
 * add-on enforcement (403), permission checks, and missing-param handling.
 */
import { action } from "~/routes/api+/mobile+/audits.image";
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

// why: external database — don't hit the real DB. $transaction runs the
// callback with a tx whose auditNote.create we can assert on.
const txAuditNoteCreate = vi.hoisted(() => vi.fn());
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    auditAsset: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: any) =>
      fn({ auditNote: { create: txAuditNoteCreate } })
    ),
  },
}));

// why: external service — don't actually process/upload images
vi.mock("~/modules/audit/image.service.server", () => ({
  uploadAuditImage: vi.fn(),
}));
vi.mock("~/modules/audit/helpers.server", () => ({
  createAuditAssetImagesAddedNote: vi.fn(),
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
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { createAuditAssetImagesAddedNote } from "~/modules/audit/helpers.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createImageRequest(opts: {
  auditSessionId?: string;
  auditAssetId?: string;
  content?: string;
}) {
  const params = new URLSearchParams({ orgId: "org-1" });
  if (opts.auditSessionId) params.set("auditSessionId", opts.auditSessionId);
  if (opts.auditAssetId) params.set("auditAssetId", opts.auditAssetId);
  // content travels in the multipart body now (not the query string)
  const form = new FormData();
  if (opts.content !== undefined) form.set("content", opts.content);
  return new Request(`http://localhost/api/mobile/audits/image?${params}`, {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: form,
  });
}

describe("POST /api/mobile/audits/image", () => {
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
    (db.auditAsset.findFirst as any).mockResolvedValue({ id: "audit-asset-1" });
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (requireAuditAssignee as any).mockResolvedValue(undefined);
    (uploadAuditImage as any).mockResolvedValue({ id: "img-1" });
  });

  it("uploads the photo and records a default images-added note", async () => {
    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.image.id).toBe("img-1");
    expect(uploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        organizationId: "org-1",
        uploadedById: "user-1",
        auditAssetId: "audit-asset-1",
      })
    );
    // no content → auto-generated images-added note
    expect(createAuditAssetImagesAddedNote).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        auditAssetId: "audit-asset-1",
        userId: "user-1",
        imageIds: ["img-1"],
      })
    );
    expect(txAuditNoteCreate).not.toHaveBeenCalled();
  });

  it("with content, records a COMMENT note tagging the uploaded image", async () => {
    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          content: "Dent on top",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    expect(txAuditNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          userId: "user-1",
          type: "COMMENT",
          content: expect.stringContaining(
            '{% audit_images count=1 ids="img-1" /%}'
          ),
        }),
      })
    );
    expect(createAuditAssetImagesAddedNote).not.toHaveBeenCalled();
  });

  it("strips Markdoc delimiters from content so the audit_images tag can't be injected", async () => {
    await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          content: 'evil {% audit_images ids="stolen-id" /%} text',
        }),
      })
    );

    const noteContent = (txAuditNoteCreate as any).mock.calls[0][0].data
      .content as string;
    // injected tag delimiters removed; only the trusted trailing tag remains
    expect(noteContent).not.toContain('{% audit_images ids="stolen-id"');
    expect(noteContent).toContain('{% audit_images count=1 ids="img-1" /%}');
  });

  it("returns 403 when the workspace lacks the Audits add-on (revenue bypass closed)", async () => {
    const addonErr = new Error("Audit functionality is not enabled");
    (addonErr as any).status = 403;
    (requireMobileAuditsEnabled as any).mockRejectedValue(addonErr);

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });

  it("returns 400 when auditSessionId/auditAssetId query params are missing", async () => {
    const result = await action(
      createActionArgs({ request: createImageRequest({}) })
    );

    expect((result as unknown as Response).status).toBe(400);
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });

  it("returns 404 when auditAssetId is not in the session (cross-tenant guard)", async () => {
    (db.auditSession.findFirst as any).mockResolvedValue({ id: "session-1" });
    (db.auditAsset.findFirst as any).mockResolvedValue(null); // belongs elsewhere

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(404);
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an assignee of the audit", async () => {
    (getMobileUserContext as any).mockResolvedValue({ role: "BASE" });
    const assigneeErr = new Error("Not an assignee");
    (assigneeErr as any).status = 403;
    (requireAuditAssignee as any).mockRejectedValue(assigneeErr);

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
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
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });

  it("returns 403 when the user lacks audit:update permission", async () => {
    const permErr = new Error("Permission denied");
    (permErr as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permErr);

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });
});
