/**
 * Route action tests for `/audits/:auditId` — `delete-audit` intent only.
 *
 * These tests cover the wiring that the service-layer tests can't reach:
 *   - The route requests `PermissionAction.delete` for this intent (not
 *     `update`, which is used for edit/cancel/complete).
 *   - The 403 self-service/base guard fires even when a caller happens to
 *     hold `delete` permission (defense-in-depth against a future config
 *     change).
 *   - `confirmation` is a required form field — missing/empty submissions
 *     are rejected before `deleteAuditSession` is called.
 *   - Happy path returns a redirect to `/audits` (not a JSON `data(...)`
 *     payload).
 *   - 404/400/409 ShelfErrors thrown by the service surface with the
 *     matching HTTP status via `makeShelfError`.
 *
 * Lives under `test/routes-tests/` rather than next to the route itself
 * because React Router's flat-routes scanner auto-registers any `*.ts` /
 * `*.tsx` file inside `app/routes/` as a route module.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 * @see {@link file://../../../app/modules/audit/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { action } from "~/routes/_layout+/audits.$auditId";
import { deleteAuditSession } from "~/modules/audit/service.server";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: keep service calls out of this test — it asserts the route wiring,
// not the DB behavior of findFirst/deleteMany.
vi.mock("~/modules/audit/service.server", () => ({
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
  getAuditSessionDetails: vi.fn(),
}));

// why: the route imports completeAuditWithImages for a different intent;
// stub the module so the import graph loads under node vitest env.
vi.mock("~/modules/audit/complete-audit-with-images.server", () => ({
  completeAuditWithImages: vi.fn(),
}));

// why: permission resolution is mocked so we can drive `organizationId` +
// `isSelfServiceOrBase` from each test.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the real db.server calls db.$connect() at module load outside of
// production. Stub it since no test in this file touches the DB directly.
vi.mock("~/database/db.server", () => ({
  db: {
    auditScan: { count: vi.fn() },
    teamMember: { findMany: vi.fn() },
  },
}));

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/**
 * Build a POST Request for the delete-audit intent. Body is real URL-encoded
 * form data so the route's `await request.clone().formData()` call works
 * without a mocked parser.
 */
function makeDeleteRequest(
  fields: Record<string, string> = { confirmation: "Q4 Audit" }
): Request {
  return new Request("http://localhost/audits/audit-1", {
    method: "POST",
    body: new URLSearchParams({
      intent: "delete-audit",
      ...fields,
    }),
  });
}

describe("audits.$auditId action — delete-audit intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    vi.mocked(deleteAuditSession).mockResolvedValue(undefined);
  });

  it("requests PermissionAction.delete (not .update) for the delete-audit intent", async () => {
    await action(
      createActionArgs({
        request: makeDeleteRequest(),
        params: { auditId: "audit-1" },
        context: mockContext,
      })
    );

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.audit,
        action: PermissionAction.delete,
        userId: "user-1",
      })
    );
  });

  it("forwards auditId, organizationId, userId, and expectedName to the service", async () => {
    await action(
      createActionArgs({
        request: makeDeleteRequest({ confirmation: "  Q4 audit  " }),
        params: { auditId: "audit-1" },
        context: mockContext,
      })
    );

    expect(deleteAuditSession).toHaveBeenCalledWith({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      userId: "user-1",
      // Whitespace is preserved at this boundary — normalization happens
      // inside the service so the comparison has the DB name in hand.
      expectedName: "  Q4 audit  ",
    });
  });

  it("redirects to /audits on success (never a JSON data payload)", async () => {
    const response = (await action(
      createActionArgs({
        request: makeDeleteRequest(),
        params: { auditId: "audit-1" },
        context: mockContext,
      })
    )) as Response;

    // React Router's `redirect(...)` returns a Response with a 3xx status
    // and a Location header. A JSON `data(...)` response would have
    // status 200 and no Location header — distinguishing the two is the
    // whole point of this assertion.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toBe("/audits");
  });

  it("returns 403 and does NOT call the service when the caller is self-service/base", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
    } as any);

    const response = (await action(
      createActionArgs({
        request: makeDeleteRequest(),
        params: { auditId: "audit-1" },
        context: mockContext,
      })
    )) as any;

    expect(response.init?.status).toBe(403);
    expect(deleteAuditSession).not.toHaveBeenCalled();
  });

  it("rejects when the confirmation field is missing and does NOT call the service", async () => {
    // URLSearchParams drops the `confirmation` key entirely → zod's
    // `z.string().min(1)` fails in parseData, which `makeShelfError`
    // converts to a non-200 response.
    const response = (await action(
      createActionArgs({
        request: new Request("http://localhost/audits/audit-1", {
          method: "POST",
          body: new URLSearchParams({ intent: "delete-audit" }),
        }),
        params: { auditId: "audit-1" },
        context: mockContext,
      })
    )) as any;

    expect(response.init?.status).toBeDefined();
    expect(response.init.status).not.toBe(200);
    expect(deleteAuditSession).not.toHaveBeenCalled();
  });

  it.each([
    [400, "Confirmation did not match the audit name."],
    [404, "Audit not found."],
    [409, "Only archived audits can be deleted. Archive it first."],
  ])(
    "surfaces a %s ShelfError from the service with the matching status",
    async (status, message) => {
      vi.mocked(deleteAuditSession).mockRejectedValue(
        new ShelfError({
          cause: null,
          message,
          label: "Audit",
          status: status as 400 | 404 | 409,
        })
      );

      const response = (await action(
        createActionArgs({
          request: makeDeleteRequest(),
          params: { auditId: "audit-1" },
          context: mockContext,
        })
      )) as any;

      expect(response.init?.status).toBe(status);
      expect(response.data?.error?.message).toBe(message);
    }
  );
});
