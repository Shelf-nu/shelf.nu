// @vitest-environment node
/**
 * Audit image evidence — assignment and parent binding.
 *
 * Reported externally against `shelf@2.1.2` (GHSA-433r-fpjf-cc4h): an
 * authenticated low-privilege member could read and delete AuditImages
 * belonging to an audit they were not assigned to, within their own
 * organization.
 *
 * Two independent flaws on one route:
 *
 *  1. Neither the loader nor the action checked AuditAssignment. `audit:read`
 *     and `audit:update` authorize the VERB, never the object.
 *  2. The delete never bound the body's `imageId` to the `auditId`/`assetId`
 *     in the URL, so an image from an entirely different audit could be named.
 *
 * The delete removes the storage objects before the row, so an unscoped lookup
 * destroys the evidence irreversibly.
 *
 * @see {@link file://./../../../app/routes/api+/audits.$auditId.assets.$assetId.images.ts}
 */

import { OrganizationRoles } from "@prisma/client";

// why: React Router v7 single fetch — `data()` must return a real Response so
// the error path has an assertable status.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };
});

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not what's under test — it must PASS, so the assertion
// proves the ASSIGNMENT check is what refuses, not the permission check.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockRequireAuditAssignee } = vi.hoisted(() => ({
  mockRequireAuditAssignee: vi.fn(),
}));
// why: the guard itself does a DB lookup. Mocking it lets each test choose
// "assigned" (resolves) or "not assigned" (throws), which is the variable
// under test.
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssignee: mockRequireAuditAssignee,
}));

// why: external storage + database; these are also the sinks asserted unreached.
const { mockGetAuditImages, mockDeleteAuditImage } = vi.hoisted(() => ({
  mockGetAuditImages: vi.fn().mockResolvedValue([]),
  mockDeleteAuditImage: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/modules/audit/image.service.server", () => ({
  getAuditImages: mockGetAuditImages,
  deleteAuditImage: mockDeleteAuditImage,
}));

import {
  action,
  loader,
} from "~/routes/api+/audits.$auditId.assets.$assetId.images";

const AUDIT_ID = "audit-1";
const ASSET_ID = "auditasset-1";
const ORG_ID = "org-1";

/** The 403 the guard throws for a member who is not an assignee. */
function notAnAssignee() {
  const err = new Error("You don't have permission to view this audit");
  Object.assign(err, { status: 403, isShelfError: true });
  return err;
}

function args(body?: Record<string, string>) {
  return {
    request: new Request(
      `https://app.shelf.nu/api/audits/${AUDIT_ID}/assets/${ASSET_ID}/images`,
      body
        ? { method: "POST", body: new URLSearchParams(body) }
        : { method: "GET" }
    ),
    params: { auditId: AUDIT_ID, assetId: ASSET_ID },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("audit image evidence authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuditImages.mockResolvedValue([]);
    mockDeleteAuditImage.mockResolvedValue(true);
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      isSelfServiceOrBase: true,
      role: OrganizationRoles.BASE,
    });
  });

  it("refuses to READ evidence for an audit the caller is not assigned to", async () => {
    mockRequireAuditAssignee.mockRejectedValue(notAnAssignee());

    await loader(args());

    // The images are never fetched — the guard runs before the read, so an
    // unassigned member learns nothing about the audit's contents.
    expect(mockGetAuditImages).not.toHaveBeenCalled();
  });

  it("refuses to DELETE evidence for an audit the caller is not assigned to", async () => {
    mockRequireAuditAssignee.mockRejectedValue(notAnAssignee());

    await action(args({ intent: "delete", imageId: "img-1" }));

    // Asserting the sink: the delete removes storage objects before the DB
    // row, so "did not throw later" is not good enough — it must never run.
    expect(mockDeleteAuditImage).not.toHaveBeenCalled();
  });

  it("binds the image to the audit and asset named in the URL", async () => {
    mockRequireAuditAssignee.mockResolvedValue(undefined);

    await action(args({ intent: "delete", imageId: "img-1" }));

    // The reported second flaw: `imageId` came from the body and was scoped by
    // organization alone, so it could name an image from a different audit.
    expect(mockDeleteAuditImage).toHaveBeenCalledWith({
      imageId: "img-1",
      organizationId: ORG_ID,
      auditSessionId: AUDIT_ID,
      auditAssetId: ASSET_ID,
    });
  });

  it("still lets an assigned member read and delete", async () => {
    mockRequireAuditAssignee.mockResolvedValue(undefined);

    await loader(args());
    expect(mockGetAuditImages).toHaveBeenCalledTimes(1);

    await action(args({ intent: "delete", imageId: "img-1" }));
    expect(mockDeleteAuditImage).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's role through to the guard", async () => {
    mockRequireAuditAssignee.mockResolvedValue(undefined);

    await loader(args());

    // ADMIN/OWNER short-circuit inside the guard, so the route must forward
    // `isSelfServiceOrBase` rather than assuming everyone is restricted.
    expect(mockRequireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: AUDIT_ID,
        organizationId: ORG_ID,
        userId: "user-1",
        isSelfServiceOrBase: true,
      })
    );
  });
});
