/**
 * Test suite for POST /api/mobile/audits/image.
 *
 * Covers condition-photo upload + matching evidence note (default vs content),
 * the shared-guard delegation, cross-tenant protection, the paid Audits
 * add-on enforcement (403), permission checks, and missing-param handling.
 *
 * After the Task-6 refactor the route delegates to:
 *  - `requireAuditAssetInSession` (shared guard, replaces inlined db lookups)
 *  - `uploadAuditImage({ returnParsedFormData: true })` (bounded parse)
 *  - `createAuditImageEvidenceNote` (sanitized, transactional note writer)
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

// why: external auth — don't hit Supabase. getMobileUserContext carries the
// paid-add-on flag (canUseAudits) so we can assert it gates this route
// (#2551 replaced the old requireMobileAuditsEnabled helper).
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  getMobileUserContext: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: shared guard encapsulates org-scoped session + asset-in-session +
// assignee scoping; unit-tested in mobile-evidence.server.test.ts.
vi.mock("~/modules/audit/mobile-evidence.server", () => ({
  requireAuditAssetInSession: vi.fn(),
}));

// why: external database — don't hit the real DB. $transaction runs the
// callback with an opaque tx; createAuditImageEvidenceNote is mocked so it
// never touches the tx.
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(async (fn: any) => fn({})),
  },
}));

// why: external service — don't actually process/upload images
vi.mock("~/modules/audit/image.service.server", () => ({
  uploadAuditImage: vi.fn(),
}));

// why: shared note writer is unit-tested in helpers.server.test.ts;
// here we only verify the route forwards the right arguments.
vi.mock("~/modules/audit/helpers.server", () => ({
  createAuditAssetImagesAddedNote: vi.fn(),
  createAuditImageEvidenceNote: vi.fn(),
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
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { requireAuditAssetInSession } from "~/modules/audit/mobile-evidence.server";
import { db } from "~/database/db.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { createAuditImageEvidenceNote } from "~/modules/audit/helpers.server";

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
  // content travels in the multipart body (not the query string)
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
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: true,
      canUseAudits: true,
    });
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (requireAuditAssetInSession as any).mockResolvedValue(undefined);
    // Default: uploadAuditImage returns the new bounded shape
    (uploadAuditImage as any).mockResolvedValue({
      image: { id: "img-1" },
      formData: new FormData(),
    });
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

    // Route must call uploadAuditImage with returnParsedFormData: true
    expect(uploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        organizationId: "org-1",
        uploadedById: "user-1",
        auditAssetId: "audit-asset-1",
        returnParsedFormData: true,
      })
    );

    // No content in formData → content arg is null → delegate note to the shared helper
    expect(createAuditImageEvidenceNote).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        auditAssetId: "audit-asset-1",
        userId: "user-1",
        imageIds: ["img-1"],
        content: null,
      })
    );
  });

  it("with content, forwards it unchanged to createAuditImageEvidenceNote", async () => {
    // Route must NOT sanitize; sanitization is the helper's responsibility.
    const fd = new FormData();
    fd.set("content", "Dent on top");
    (uploadAuditImage as any).mockResolvedValue({
      image: { id: "img-1" },
      formData: fd,
    });

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
    expect(createAuditImageEvidenceNote).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        auditAssetId: "audit-asset-1",
        userId: "user-1",
        imageIds: ["img-1"],
        content: "Dent on top",
      })
    );
  });

  it("forwards raw (unsanitized) content to the helper (sanitization is the helper's job)", async () => {
    // The route must pass content verbatim; stripping Markdoc delimiters is
    // encapsulated in buildAuditImagesNoteContent (note-content.server) which
    // createAuditImageEvidenceNote calls — unit-tested separately there.
    const rawContent = 'evil {% audit_images ids="stolen-id" /%} text';
    const fd = new FormData();
    fd.set("content", rawContent);
    (uploadAuditImage as any).mockResolvedValue({
      image: { id: "img-1" },
      formData: fd,
    });

    await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
          content: rawContent,
        }),
      })
    );

    // The route forwards the raw string unchanged — no stripping here
    expect(createAuditImageEvidenceNote).toHaveBeenCalledWith(
      expect.objectContaining({ content: rawContent })
    );
  });

  it("returns 403 when the workspace lacks the Audits add-on (revenue bypass closed)", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: true,
      canUseAudits: false,
    });

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

  it("returns 404 when requireAuditAssetInSession rejects with 404 (cross-tenant guard)", async () => {
    const notFoundErr = Object.assign(new Error("Audit session not found"), {
      status: 404,
    });
    (requireAuditAssetInSession as any).mockRejectedValue(notFoundErr);

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(404);
    expect(requireAuditAssetInSession).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        auditAssetId: "audit-asset-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    );
    expect(uploadAuditImage).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not an assignee of the audit", async () => {
    const assigneeErr = Object.assign(new Error("Not an assignee"), {
      status: 403,
    });
    (requireAuditAssetInSession as any).mockRejectedValue(assigneeErr);

    const result = await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(requireAuditAssetInSession).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        organizationId: "org-1",
        userId: "user-1",
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

  it("wraps the $transaction call and delegates note to createAuditImageEvidenceNote inside it", async () => {
    await action(
      createActionArgs({
        request: createImageRequest({
          auditSessionId: "session-1",
          auditAssetId: "audit-asset-1",
        }),
      })
    );

    expect(db.$transaction).toHaveBeenCalled();
    expect(createAuditImageEvidenceNote).toHaveBeenCalled();
  });
});
