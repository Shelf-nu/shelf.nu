// @vitest-environment node
/**
 * Route action tests for `/audits/:auditId/duplicate`.
 *
 * The service decides who carries over to the copy; the route decides who is
 * told. These tests pin that wiring: the carried-over team gets the assignment
 * email for the NEW audit, and the person who clicked Duplicate is left out
 * even when they are on the team.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.duplicate.tsx}
 * @see {@link file://../../../app/modules/audit/assignment-emails.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { sendAuditAssignedEmails } from "~/modules/audit/assignment-emails.server";
import { duplicateAuditSession } from "~/modules/audit/service.server";
import { action } from "~/routes/_layout+/audits.$auditId.duplicate";
import { ShelfError } from "~/utils/error";

// why: the real service copies the audit in a database transaction; the stub
// lets each test set who carried over.
vi.mock("~/modules/audit/service.server", () => ({
  duplicateAuditSession: vi.fn(),
  DUPLICATE_AUDIT_ALLOWED_STATUSES: ["COMPLETED", "CANCELLED", "ARCHIVED"],
}));

// why: the fan-out loads the audit from the DB and sends real mail; a stub
// lets the tests assert exactly which user ids are handed to it.
vi.mock("~/modules/audit/assignment-emails.server", () => ({
  sendAuditAssignedEmails: vi.fn(),
}));

// why: the action gates on permission; grant it without reaching auth or the DB.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
}));

// why: the real db.server connects at module load outside production; the
// action under test never reads it (only the loader does).
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the success toast goes through the server-sent-events emitter, which
// has no listener in a unit test.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route passes the browser's hints on to the fan-out; a fixed value
// lets the test assert they arrive untouched.
vi.mock("~/utils/client-hints", () => ({
  getClientHint: vi.fn().mockReturnValue({ timeZone: "UTC", locale: "en-US" }),
}));

const ACTOR = "user-1";

const mockContext = {
  getSession: () => ({ userId: ACTOR }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/** Runs the duplicate action for `audit-original` as the actor. */
function duplicate() {
  return action(
    createActionArgs({
      request: new Request("http://localhost/audits/audit-original/duplicate", {
        method: "POST",
      }),
      context: mockContext,
      params: { auditId: "audit-original" },
    })
  );
}

describe("duplicate-audit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emails the carried-over team about the new audit, never the person duplicating", async () => {
    vi.mocked(duplicateAuditSession).mockResolvedValue({
      newSession: { id: "audit-copy", name: "ZZ Test Audit (Copy)" },
      droppedAssetCount: 0,
      originalAssetCount: 2,
      carriedOverAssigneeIds: ["user-2", ACTOR, "user-3"],
    } as never);

    const response = (await duplicate()) as Response;

    expect(duplicateAuditSession).toHaveBeenCalledWith({
      auditSessionId: "audit-original",
      organizationId: "org-1",
      userId: ACTOR,
    });
    expect(sendAuditAssignedEmails).toHaveBeenCalledTimes(1);
    expect(sendAuditAssignedEmails).toHaveBeenCalledWith({
      auditId: "audit-copy",
      organizationId: "org-1",
      recipientUserIds: ["user-2", "user-3"],
      hints: { timeZone: "UTC", locale: "en-US" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/audits/audit-copy/overview"
    );
  });

  it("hands the fan-out an empty list when only the person duplicating carried over", async () => {
    vi.mocked(duplicateAuditSession).mockResolvedValue({
      newSession: { id: "audit-copy", name: "ZZ Test Audit (Copy)" },
      droppedAssetCount: 0,
      originalAssetCount: 2,
      carriedOverAssigneeIds: [ACTOR],
    } as never);

    await duplicate();

    expect(sendAuditAssignedEmails).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: "audit-copy", recipientUserIds: [] })
    );
  });

  it("emails nobody when the duplication is refused", async () => {
    vi.mocked(duplicateAuditSession).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "Only completed, cancelled, or archived audits can be duplicated.",
        label: "Audit",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = (await duplicate()) as { init?: { status?: number } };

    expect(sendAuditAssignedEmails).not.toHaveBeenCalled();
    expect(response.init?.status).toBe(400);
  });
});
