// @vitest-environment node
/**
 * Authorization tests for the WEB audit record-scan endpoint.
 *
 * `audit: update` alone does not identify who may scan into an audit: BASE and
 * SELF_SERVICE both hold that permission (packages/permissions matrix), so this
 * route has to apply the same assignee gate its mobile sibling does. It
 * previously stopped at `requirePermission`, which let any workspace member
 * record a scan on any audit — and since a scan claims the audit's write-once
 * `startedAt`, the wrong actor and time became permanent.
 *
 * Also pins that the body's `isExpected` is NOT forwarded to the service: the
 * server derives expectedness from the audit's own rows.
 *
 * @see {@link file://../../../app/routes/api+/audits.record-scan.ts}
 * @see {@link file://../../../app/routes/api+/mobile+/audits.record-scan.ts} the sibling
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/audits.record-scan";
import { ShelfError } from "~/utils/error";

const { recordAuditScan, requireAuditAssignee, requirePermission } = vi.hoisted(
  () => ({
    recordAuditScan: vi.fn(),
    requireAuditAssignee: vi.fn(),
    requirePermission: vi.fn(),
  })
);

// why: the gate under test consumes `isSelfServiceOrBase` from here; mocking
// lets each test act as a different role without touching auth or the DB.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: the service is the boundary we assert against — these tests are about
// which calls the route makes, not what scanning does.
vi.mock("~/modules/audit/service.server", () => ({
  recordAuditScan,
  requireAuditAssignee,
}));

/**
 * Builds the form-encoded request the web scanner posts.
 *
 * why: a URLSearchParams body, not FormData — happy-dom drops empty fields on
 * the Request round-trip (see reference notes on FormData in route tests).
 */
function createRecordScanRequest(
  fields: Record<string, string> = {
    auditSessionId: "audit-1",
    qrId: "qr-abc",
    assetId: "asset-1",
    isExpected: "true",
  }
) {
  return new Request("http://localhost/api/audits/record-scan", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/**
 * Minimal `context` stub — the action reads only `getSession().userId`.
 */
function callAction(request = createRecordScanRequest()) {
  return action({
    request,
    context: { getSession: () => ({ userId: "user-1" }) },
    params: {},
  } as never);
}

describe("POST /api/audits/record-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuditAssignee.mockResolvedValue(undefined);
    recordAuditScan.mockResolvedValue({
      scanId: "scan-1",
      auditAssetId: "audit-asset-1",
      foundAssetCount: 5,
      unexpectedAssetCount: 1,
    });
  });

  it("requires assignee status for a BASE caller before recording anything", async () => {
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
      role: "BASE",
    });

    await callAction();

    expect(requireAuditAssignee).toHaveBeenCalledWith({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: expect.any(String),
      isSelfServiceOrBase: true,
    });
  });

  it("does not record the scan when the assignee gate rejects", async () => {
    // why: without this the caller still wins the audit's write-once first-start
    // claim, stamping the wrong actor and time on an AUDIT_STARTED that no later
    // real start can correct.
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
      role: "BASE",
    });
    // why: a real ShelfError, not a plain Error with a `status` property —
    // `makeShelfError` only preserves the status of a ShelfError, so a plain
    // one would surface as 500 and the test would prove nothing about the gate.
    requireAuditAssignee.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Only users assigned to this audit can perform this action.",
        status: 403,
        label: "Audit",
      })
    );

    const result = await callAction();

    expect(recordAuditScan).not.toHaveBeenCalled();
    expect((result as { init?: ResponseInit | null }).init?.status).toBe(403);
  });

  it("lets an ADMIN scan any audit in the workspace", async () => {
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
      role: "ADMIN",
    });

    await callAction();

    // The gate short-circuits to allow-all for ADMIN/OWNER, mirroring the
    // permissions resolver — but it must still be CALLED with the right flag.
    expect(requireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({ isSelfServiceOrBase: false })
    );
    expect(recordAuditScan).toHaveBeenCalledTimes(1);
  });

  it("does not forward the client's isExpected flag to the service", async () => {
    // why: a device's cached expected list goes stale (an admin can remove an
    // asset from a still-PENDING audit), so the flag is accepted for wire
    // compatibility and ignored — the service reads the AuditAsset row instead.
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
      role: "ADMIN",
    });

    await callAction();

    expect(recordAuditScan).toHaveBeenCalledWith({
      auditSessionId: "audit-1",
      qrId: "qr-abc",
      assetId: "asset-1",
      userId: expect.any(String),
      organizationId: "org-1",
    });
  });
});
