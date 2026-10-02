// @vitest-environment node
/**
 * POST /api/audits/:auditId/upload-image
 *
 * The web scan list's "Add image" button posts here. Its file input opens the
 * camera, and the page adds `capturedAt` (the file's `lastModified`) so the
 * server can stamp a photo that was just taken. This suite pins that the route
 * reads `capturedAt` from the body and hands it to the upload, and that an
 * upload without one is passed through unstamped.
 *
 * @see {@link file://./../../../app/routes/api+/audits.$auditId.upload-image.ts}
 * @see {@link file://./../../../app/components/audit/audit-asset-actions.tsx}
 */

// why: React Router v7 single fetch: `data()` must return a real Response so
// the body and status are assertable
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: the RBAC gate is not under test and must pass
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    organizationId: "org-1",
    isSelfServiceOrBase: false,
  }),
}));

// why: the assignee guard does its own lookup; it is not under test
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssigneeForBaseSelfService: vi.fn(),
}));

// why: external database; the audit lookup and the note transaction
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: "audit-1",
        organizationId: "org-1",
        assignments: [],
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
  },
}));

// why: image processing and storage are exercised in the service's own tests
const { mockUploadAuditImage } = vi.hoisted(() => ({
  mockUploadAuditImage: vi.fn(),
}));
vi.mock("~/modules/audit/image.service.server", () => ({
  uploadAuditImage: mockUploadAuditImage,
}));

// why: the activity note writer is tested in helpers.server.test.ts
vi.mock("~/modules/audit/helpers.server", () => ({
  createAuditAssetImagesAddedNote: vi.fn(),
}));

// why: toast notifications go through the server-sent event emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { action } from "~/routes/api+/audits.$auditId.upload-image";

/** The multipart body the "Add image" button sends. */
function uploadRequest(fields: { capturedAt?: string }) {
  const form = new FormData();
  form.append(
    "image",
    new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" })
  );
  form.append("auditAssetId", "audit-asset-1");
  if (fields.capturedAt) form.append("capturedAt", fields.capturedAt);
  return new Request("http://localhost/api/audits/audit-1/upload-image", {
    method: "POST",
    body: form,
  });
}

function callAction(request: Request) {
  return action({
    request,
    params: { auditId: "audit-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never) as unknown as Promise<Response>;
}

describe("POST /api/audits/:auditId/upload-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadAuditImage.mockResolvedValue({ id: "image-1" });
  });

  it("hands the photo's capture time to the upload", async () => {
    const response = await callAction(
      uploadRequest({ capturedAt: "2026-10-01T21:01:30.000Z" })
    );

    expect(response.status).toBe(200);
    expect(mockUploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "audit-1",
        organizationId: "org-1",
        uploadedById: "user-1",
        auditAssetId: "audit-asset-1",
        capturedAt: "2026-10-01T21:01:30.000Z",
      })
    );
  });

  it("passes no capture time when the page sent none", async () => {
    await callAction(uploadRequest({}));

    expect(mockUploadAuditImage).toHaveBeenCalledWith(
      expect.objectContaining({ capturedAt: null })
    );
  });
});
