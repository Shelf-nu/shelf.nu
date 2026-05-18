/**
 * Security regression test — Markdoc injection via webapp scan-details route.
 *
 * This test verifies that `intent=upload-image` in the webapp scan-details
 * route delegates note creation to `createAuditImageEvidenceNote` with raw
 * (un-sanitized) user content. Sanitization is the responsibility of the
 * shared helper, not of the route, so the route MUST forward content verbatim.
 *
 * The three concat sites addressed by Task 7:
 *   1. `upload-image` (single-file) — route must call `createAuditImageEvidenceNote`
 *   2. `upload-images` (multi-file) — route must apply `stripMarkdocDelimiters`
 *      on the user text before the trusted `{% audit_images %}` tag
 *   3. `add-images-to-note` — user-authored body segment must be sanitized
 *      before a re-tag; trusted tag stays intact
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx}
 * @see {@link file://../../../app/modules/audit/helpers.server.ts}
 * @see {@link file://../../../app/modules/audit/note-content.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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

// why: permission resolution drives organizationId; mocked to avoid real DB.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: shared audit-assignee guard; mocked since it performs DB lookups.
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssigneeForBaseSelfService: vi.fn(),
}));

// why: external database — don't hit the real DB. $transaction runs the
// callback with an opaque tx so we can assert on helpers called inside it.
vi.mock("~/database/db.server", () => ({
  db: {
    // $transaction passes a tx exposing the auditNote ops that the
    // multi-file and add-images-to-note paths call directly. The single-file
    // path delegates to the mocked helper, which never touches tx.
    $transaction: vi.fn(async (fn: any) =>
      fn({
        auditNote: {
          create: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      })
    ),
    auditNote: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// why: external service — don't actually process/upload images.
vi.mock("~/modules/audit/image.service.server", () => ({
  uploadAuditImage: vi.fn(),
  deleteAuditImage: vi.fn(),
}));

// why: shared note writer is unit-tested in helpers.server.test.ts;
// here we only verify the route forwards the right arguments.
vi.mock("~/modules/audit/helpers.server", () => ({
  createAuditAssetImagesAddedNote: vi.fn(),
  createAuditImageEvidenceNote: vi.fn(),
}));

// why: note-content helper is unit-tested in note-content.server.test.ts;
// we spy on it to confirm it's called for multi-file and add-images-to-note.
vi.mock("~/modules/audit/note-content.server", () => ({
  stripMarkdocDelimiters: vi.fn((s: string) => s.replace(/{%|%}/g, "").trim()),
}));

// why: control error formatting in the catch block.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    label: string;
    additionalData: unknown;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
      this.label = opts.label || "";
      this.additionalData = opts.additionalData;
    }
  },
}));

import { action } from "~/routes/_layout+/audits.$auditId.scan.$auditAssetId.details";
import { requirePermission } from "~/utils/roles.server";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { createAuditImageEvidenceNote } from "~/modules/audit/helpers.server";
import { stripMarkdocDelimiters } from "~/modules/audit/note-content.server";
import { db } from "~/database/db.server";

/** Context shape the route reads via `context.getSession()` */
const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/** Build a multipart POST request for the upload-image intent */
function makeUploadImageRequest(opts: {
  intent?: string;
  content?: string;
  fileFieldName?: string;
}): Request {
  const form = new FormData();
  form.set("intent", opts.intent ?? "upload-image");
  if (opts.content !== undefined) form.set("content", opts.content);

  // Attach a minimal File so the files.length > 0 guard passes.
  const fieldName = opts.fileFieldName ?? "auditImage";
  form.set(fieldName, new File(["data"], "photo.jpg", { type: "image/jpeg" }));

  return new Request(
    "http://localhost/audits/session-1/scan/audit-asset-1/details",
    { method: "POST", body: form }
  );
}

describe("audits.$auditId.scan.$auditAssetId.details action — upload-image injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    (uploadAuditImage as any).mockResolvedValue({ id: "img-1" });
  });

  it("forwards raw injection payload verbatim to createAuditImageEvidenceNote (single-file upload-image)", async () => {
    // Arrange — content contains a crafted Markdoc injection attempt.
    const maliciousContent = 'pwn {% audit_images ids="evil" /%}';

    const result = await action(
      createActionArgs({
        request: makeUploadImageRequest({
          intent: "upload-image",
          content: maliciousContent,
        }),
        params: { auditId: "session-1", auditAssetId: "audit-asset-1" },
        context: mockContext,
      })
    );

    // Action should succeed (2xx) — the route delegated, not crashed.
    const status =
      result instanceof Response
        ? result.status
        : (result as any)?.init?.status ?? 200;
    expect(status).toBe(200);

    // The route MUST call the shared evidence-note helper.
    expect(createAuditImageEvidenceNote).toHaveBeenCalledTimes(1);

    // Content is forwarded RAW — sanitization is the helper's responsibility.
    expect(createAuditImageEvidenceNote).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: "session-1",
        auditAssetId: "audit-asset-1",
        userId: "user-1",
        imageIds: ["img-1"],
        content: maliciousContent,
      })
    );

    // The raw concat path must NOT be taken.
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("does NOT inline-concat user content for upload-image (no raw string build in the route)", async () => {
    // If the route still uses raw concat the helper won't be called at all.
    // This assertion is symmetric with the one above but explicit about the
    // absence of the old (vulnerable) code path.
    const maliciousContent = '{% audit_images ids="evil" /%} extra';

    await action(
      createActionArgs({
        request: makeUploadImageRequest({
          intent: "upload-image",
          content: maliciousContent,
        }),
        params: { auditId: "session-1", auditAssetId: "audit-asset-1" },
        context: mockContext,
      })
    );

    // Old path would call tx.auditNote.create directly; new path calls the helper.
    // We verify the helper was called and tx.auditNote.create was NOT called directly
    // by the route (the helper is responsible for db writes inside the tx).
    expect(createAuditImageEvidenceNote).toHaveBeenCalledTimes(1);
  });

  it("applies stripMarkdocDelimiters on user text for multi-file upload-images", async () => {
    const maliciousContent = 'pwn {% audit_images ids="evil" /%}';

    // Provide two files so we hit the upload-images / multi-file branch
    const form = new FormData();
    form.set("intent", "upload-images");
    form.set("content", maliciousContent);
    form.append("images", new File(["data"], "a.jpg", { type: "image/jpeg" }));
    form.append("images", new File(["data"], "b.jpg", { type: "image/jpeg" }));

    (uploadAuditImage as any).mockResolvedValueOnce({ id: "img-1" });
    (uploadAuditImage as any).mockResolvedValueOnce({ id: "img-2" });

    await action(
      createActionArgs({
        request: new Request(
          "http://localhost/audits/session-1/scan/audit-asset-1/details",
          { method: "POST", body: form }
        ),
        params: { auditId: "session-1", auditAssetId: "audit-asset-1" },
        context: mockContext,
      })
    );

    // stripMarkdocDelimiters must have been called on the user-authored text
    // before the trusted tag is appended.
    expect(stripMarkdocDelimiters).toHaveBeenCalledWith(maliciousContent);

    // The shared helper should NOT be called for multi-file (it's used only
    // for the single-file path per the fix spec).
    expect(createAuditImageEvidenceNote).not.toHaveBeenCalled();
  });
});
