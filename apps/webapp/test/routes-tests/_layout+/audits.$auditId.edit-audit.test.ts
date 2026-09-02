/**
 * Route action tests for `/audits/:auditId` — `edit-audit` intent.
 *
 * The service tests cover the assignee set-diff; these cover the wiring the
 * service cannot see:
 *   - every `assignees[i]` picker blob is resolved to a user id and forwarded
 *     as the FULL desired set (an empty selection means "remove everyone");
 *   - the pre-multi-assign singular `assignee` field is still honoured, so a
 *     form loaded before the deploy saves without wiping the team;
 *   - only the people the service reports as ADDED are emailed, never the
 *     editor themselves.
 *
 * Lives under `test/routes-tests/` rather than next to the route itself
 * because React Router's flat-routes scanner auto-registers any `*.ts` /
 * `*.tsx` file inside `app/routes/` as a route module.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.tsx}
 * @see {@link file://../../../app/modules/audit/assignee-form.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { action } from "~/routes/_layout+/audits.$auditId";
import { sendAuditAssignedEmails } from "~/modules/audit/assignment-emails.server";
import { updateAuditSession } from "~/modules/audit/service.server";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

vi.mock("~/modules/audit/service.server", () => ({
  updateAuditSession: vi.fn(),
  cancelAuditSession: vi.fn(),
  archiveAuditSession: vi.fn(),
  deleteAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
  getAuditSessionDetails: vi.fn(),
}));

vi.mock("~/modules/audit/assignment-emails.server", () => ({
  sendAuditAssignedEmails: vi.fn(),
}));

vi.mock("~/modules/audit/complete-audit-with-images.server", () => ({
  completeAuditWithImages: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the real db.server calls db.$connect() at module load outside of
// production. Nothing here touches the DB directly.
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

const blob = (userId: string) =>
  JSON.stringify({ id: `tm-${userId}`, name: userId, userId });

function makeEditRequest(fields: Record<string, string> = {}): Request {
  return new Request("http://localhost/audits/audit-1", {
    method: "POST",
    body: new URLSearchParams({
      intent: "edit-audit",
      name: "Q4 audit",
      ...fields,
    }),
  });
}

async function runEdit(fields: Record<string, string> = {}) {
  return action(
    createActionArgs({
      request: makeEditRequest(fields),
      params: { auditId: "audit-1" },
      context: mockContext,
    })
  );
}

describe("audits.$auditId action — edit-audit intent (assignees)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as any);
    vi.mocked(updateAuditSession).mockResolvedValue({
      audit: { id: "audit-1" },
      addedAssigneeIds: [],
      removedAssigneeIds: [],
    } as any);
  });

  it("refuses a BASE/SELF_SERVICE caller with 403 before touching the service", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: true,
    } as any);

    const response = await runEdit({ "assignees[0]": blob("user-1") });

    expect((response as any).init?.status ?? (response as any).status).toBe(
      403
    );
    expect(updateAuditSession).not.toHaveBeenCalled();
    expect(sendAuditAssignedEmails).not.toHaveBeenCalled();
  });

  it("forwards the full selected set of user ids, deduplicated", async () => {
    await runEdit({
      "assignees[0]": blob("user-2"),
      "assignees[1]": blob("user-3"),
      "assignees[2]": blob("user-2"),
    });

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-1",
        organizationId: "org-1",
        userId: "user-1",
        data: expect.objectContaining({
          name: "Q4 audit",
          assigneeUserIds: ["user-2", "user-3"],
        }),
      })
    );
  });

  it("treats an empty selection as 'remove everyone'", async () => {
    await runEdit();

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeUserIds: [] }),
      })
    );
  });

  it("still honours the singular pre-multi-assign field", async () => {
    await runEdit({ assignee: blob("user-7") });

    expect(updateAuditSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeUserIds: ["user-7"] }),
      })
    );
  });

  it("emails only the people the service reports as added, never the editor", async () => {
    vi.mocked(updateAuditSession).mockResolvedValue({
      audit: { id: "audit-1" },
      addedAssigneeIds: ["user-3", "user-1"],
      removedAssigneeIds: ["user-9"],
    } as any);

    await runEdit({
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
