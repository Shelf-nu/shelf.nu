/**
 * Test suite for POST /api/audits/:auditId/upload-image, the web app's audit
 * photo upload.
 *
 * Pins what the route hands the upload service: a browser upload is always
 * `uploadedVia: "web"`, so whatever the form claims, it is stored as
 * `WEB_UPLOAD` and its phone-only fields are never read.
 *
 * @see {@link file://../../../app/routes/api+/audits.$auditId.upload-image.ts}
 * @see {@link file://../../../app/modules/audit/image.service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { accessFor } from "@helpers/role-access";
import { action } from "~/routes/api+/audits.$auditId.upload-image";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() to return Response objects (RR v7 single fetch)
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth and permission lookup; this suite is about what the
// route forwards, not who may call it.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: external database. The audit lookup returns an audit in the caller's
// org; $transaction runs the note callback with an opaque tx.
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  },
}));

// why: external storage and image processing; the service is unit-tested in
// image.service.server.test.ts.
vi.mock("~/modules/audit/image.service.server", () => ({
  uploadAuditImage: vi.fn(),
}));

// why: the activity note writer is unit-tested in helpers.server.test.ts.
vi.mock("~/modules/audit/helpers.server", () => ({
  createAuditAssetImagesAddedNote: vi.fn(),
}));

// why: the toast emitter needs a live server-sent-events channel.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { db } from "~/database/db.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { requirePermission } from "~/utils/roles.server";

describe("POST /api/audits/:auditId/upload-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      access: accessFor([OrganizationRoles.ADMIN]),
    } as never);
    vi.mocked(db.auditSession.findFirst).mockResolvedValue({
      id: "audit-1",
      organizationId: "org-1",
      assignments: [],
    } as never);
    vi.mocked(uploadAuditImage).mockResolvedValue({ id: "img-1" } as never);
  });

  it("uploads as a web upload, whatever source the form claims", async () => {
    const form = new FormData();
    form.set("auditAssetId", "audit-asset-1");
    form.set("captureSource", "CAMERA");
    form.append("image", new File(["d"], "p.jpg", { type: "image/jpeg" }));

    const response = await action(
      createActionArgs({
        request: new Request(
          "http://localhost/api/audits/audit-1/upload-image",
          {
            method: "POST",
            body: form,
          }
        ),
        params: { auditId: "audit-1" },
        context: { getSession: () => ({ userId: "user-1" }) },
      })
    );

    expect((response as unknown as Response).status).toBe(200);
    expect(uploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        uploadedById: "user-1",
        auditAssetId: "audit-asset-1",
        uploadedVia: "web",
      })
    );
  });
});
