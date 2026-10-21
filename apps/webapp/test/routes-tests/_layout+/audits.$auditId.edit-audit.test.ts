/**
 * Route action tests for `/audits/:auditId`, `edit-audit` intent only.
 *
 * `audit:update` is held by every role that runs audits, so it cannot decide
 * who may change an audit's details or reassign it. These tests pin the gate
 * the route applies on top: only callers whose access manages others' audits
 * reach `updateAuditSession`. A direct POST from anyone else is refused before
 * the service runs, whatever the actions menu offered them.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { updateAuditSession } from "~/modules/audit/service.server";
import { action } from "~/routes/_layout+/audits.$auditId";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: keep service calls out of this test; it asserts the route's gate, not
// the database behaviour of the update.
vi.mock("~/modules/audit/service.server", () => ({
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
  getAuditSessionDetails: vi.fn(),
}));

// why: the route imports completeAuditWithImages for a different intent;
// stub the module so the import graph loads under the node environment.
vi.mock("~/modules/audit/complete-audit-with-images.server", () => ({
  completeAuditWithImages: vi.fn(),
}));

// why: permission resolution is mocked so each test can hand the route the
// access of the role under test.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the real db.server connects at module load outside production; no test
// here reaches the database.
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

/** A POST for the edit-audit intent that also assigns the caller. */
function makeEditRequest(): Request {
  return new Request("http://localhost/audits/audit-1", {
    method: "POST",
    body: new URLSearchParams({
      intent: "edit-audit",
      name: "Renamed audit",
      assignee: JSON.stringify({ userId: "user-1" }),
    }),
  });
}

/** Runs the action with the given role's access. */
async function editAs(role: OrganizationRoles) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    access: accessFor([role]),
  } as any);

  return (await action(
    createActionArgs({
      request: makeEditRequest(),
      params: { auditId: "audit-1" },
      context: mockContext,
    })
  )) as any;
}

describe("audits.$auditId action, edit-audit intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateAuditSession).mockResolvedValue(undefined as never);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s with a 403 and never reaches the service",
    async (role) => {
      const response = await editAs(role);

      expect(response.init?.status).toBe(403);
      expect(updateAuditSession).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "lets %s edit and reassign the audit",
    async (role) => {
      await editAs(role);

      expect(updateAuditSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "audit-1",
          organizationId: "org-1",
          data: expect.objectContaining({
            name: "Renamed audit",
            assigneeUserId: "user-1",
          }),
        })
      );
    }
  );
});
