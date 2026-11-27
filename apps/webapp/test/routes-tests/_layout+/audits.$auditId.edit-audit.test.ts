/**
 * Route action tests for `/audits/:auditId`, `edit-audit` intent only.
 *
 * `audit:update` is held by every role that runs audits, so it cannot decide
 * who may change an audit's details or reassign it. These tests pin the gate
 * the route applies on top: only callers whose access manages others' audits
 * reach `updateAuditSession`. A direct POST from anyone else is refused before
 * the service runs, whatever the actions menu offered them.
 *
 * The service tests cover the assignee set-diff; these also cover the wiring
 * the service cannot see:
 *   - every `assignees[i]` picker blob is resolved to a user id and forwarded
 *     as the FULL desired set (an empty selection means "remove everyone");
 *   - the singular `assignee` field from older clients is still honoured, so
 *     it saves without wiping the team;
 *   - only the people the service reports as ADDED are emailed, never the
 *     editor themselves.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 * @see {@link file://../../../app/modules/audit/assignee-form.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { sendAuditAssignedEmails } from "~/modules/audit/assignment-emails.server";
import { updateAuditSession } from "~/modules/audit/service.server";
import { action } from "~/routes/_layout+/audits.$auditId";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: these tests assert the route's gate and wiring (parsing, who gets
// emailed), not the set diff itself, which service.server.test.ts covers; the
// real service would also open a database transaction.
vi.mock("~/modules/audit/service.server", () => ({
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
  getAuditSessionDetails: vi.fn(),
}));

// why: the fan-out loads the audit from the DB and sends real mail; a stub
// lets the tests assert exactly which user ids are handed to it.
vi.mock("~/modules/audit/assignment-emails.server", () => ({
  sendAuditAssignedEmails: vi.fn(),
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

/** A picker blob for one team member, as the assignee selector submits it. */
const blob = (userId: string) =>
  JSON.stringify({ id: `tm-${userId}`, name: userId, userId });

/** A POST for the edit-audit intent with the given extra form fields. */
function makeEditRequest(fields: Record<string, string> = {}): Request {
  return new Request("http://localhost/audits/audit-1", {
    method: "POST",
    body: new URLSearchParams({
      intent: "edit-audit",
      name: "Renamed audit",
      ...fields,
    }),
  });
}

/** Runs the action with the given role's access and form fields. */
async function editAs(
  role: OrganizationRoles,
  fields: Record<string, string> = {}
) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    access: accessFor([role]),
  } as any);

  return (await action(
    createActionArgs({
      request: makeEditRequest(fields),
      params: { auditId: "audit-1" },
      context: mockContext,
    })
  )) as any;
}

describe("audits.$auditId action, edit-audit intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateAuditSession).mockResolvedValue({
      audit: { id: "audit-1" },
      addedAssigneeIds: [],
      removedAssigneeIds: [],
    } as any);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s with a 403 and never reaches the service",
    async (role) => {
      const response = await editAs(role, { "assignees[0]": blob("user-1") });

      expect(response.init?.status).toBe(403);
      expect(updateAuditSession).not.toHaveBeenCalled();
      expect(sendAuditAssignedEmails).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "lets %s edit and reassign the audit",
    async (role) => {
      await editAs(role, { "assignees[0]": blob("user-1") });

      expect(updateAuditSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "audit-1",
          organizationId: "org-1",
          userId: "user-1",
          data: expect.objectContaining({
            name: "Renamed audit",
            assigneeUserIds: ["user-1"],
          }),
        })
      );
    }
  );

  it("forwards the full selected set of user ids, deduplicated", async () => {
    await editAs(OrganizationRoles.ADMIN, {
      "assignees[0]": blob("user-2"),
      "assignees[1]": blob("user-3"),
      "assignees[2]": blob("user-2"),
    });

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeUserIds: ["user-2", "user-3"],
        }),
      })
    );
  });

  it("treats an empty selection as 'remove everyone'", async () => {
    await editAs(OrganizationRoles.ADMIN);

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeUserIds: [] }),
      })
    );
  });

  it("still honours the singular field from older clients", async () => {
    await editAs(OrganizationRoles.ADMIN, { assignee: blob("user-7") });

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeUserIds: ["user-7"] }),
      })
    );
  });

  it("emails only the people the service reports as added, never the editor", async () => {
    vi.mocked(updateAuditSession).mockResolvedValueOnce({
      audit: { id: "audit-1" },
      addedAssigneeIds: ["user-3", "user-1"],
      removedAssigneeIds: ["user-9"],
    } as any);

    await editAs(OrganizationRoles.ADMIN, {
      "assignees[0]": blob("user-2"),
      "assignees[1]": blob("user-3"),
      "assignees[2]": blob("user-1"),
    });

    expect(sendAuditAssignedEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        auditId: "audit-1",
        organizationId: "org-1",
        recipientUserIds: ["user-3"],
      })
    );
  });
});
