// @vitest-environment node
/**
 * Unit tests for the audit assignment email fan-out.
 *
 * `sendAuditAssignedEmails` decides who is told they were assigned to an audit.
 * Its callers fire it without awaiting and every route test stubs it, so these
 * are the only tests that see its recipient filter, the workspace scope on its
 * audit lookup and its promise never to throw.
 *
 * @see {@link file://./assignment-emails.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { sendAuditAssignedEmails } from "./assignment-emails.server";
import { AUDIT_INCLUDE_FOR_EMAIL } from "./constants";
import { sendAuditAssignedEmail, sendAuditAssignedPush } from "./email-helpers";

// why: the helper loads the audit with its team through Prisma; the stub
// stands in for the database and lets each test set who is assigned.
vi.mock("~/database/db.server", () => ({
  db: { auditSession: { findFirst: vi.fn() } },
}));

// why: the real sender renders the template and hands it to SMTP; the stub
// records who would have been emailed.
vi.mock("./email-helpers", () => ({
  sendAuditAssignedEmail: vi.fn(),
  sendAuditAssignedPush: vi.fn(),
}));

// why: a failed send is reported through the logger and nowhere else, so the
// spy is the only way to observe it.
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn() },
}));

const hints = { timeZone: "UTC", locale: "en-US" };

/** One assignment row, shaped as `AUDIT_INCLUDE_FOR_EMAIL` loads it. */
function assignment(userId: string, email: string | null) {
  return {
    userId,
    user: {
      id: userId,
      email,
      firstName: userId,
      lastName: "Tester",
      displayName: null,
    },
  };
}

/** The audit as the lookup returns it, with the given team. */
function auditWith(assignments: ReturnType<typeof assignment>[]) {
  return { id: "audit-1", name: "ZZ Test Audit", assignments };
}

/** The user ids the sender was called for, in call order. */
function emailedUserIds() {
  return vi
    .mocked(sendAuditAssignedEmail)
    .mock.calls.map(([args]) => args.assigneeUserId);
}

describe("sendAuditAssignedEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendAuditAssignedEmail).mockResolvedValue(undefined);
  });

  it("emails only the listed recipients who are assigned to the audit", async () => {
    const audit = auditWith([
      assignment("user-2", "two@example.com"),
      assignment("user-3", "three@example.com"),
      assignment("user-4", "four@example.com"),
    ]);
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(audit as never);

    await sendAuditAssignedEmails({
      auditId: "audit-1",
      organizationId: "org-1",
      // user-3 is assigned but not listed; user-9 is listed but not assigned.
      recipientUserIds: ["user-2", "user-4", "user-9", "user-2"],
      hints,
    });

    expect(emailedUserIds()).toEqual(["user-2", "user-4"]);
    expect(sendAuditAssignedEmail).toHaveBeenCalledWith({
      audit,
      assigneeEmail: "two@example.com",
      assigneeName: "user-2 Tester",
      assigneeUserId: "user-2",
      hints,
    });
  });

  it("pushes to every recipient before any email has settled", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(
      auditWith([
        assignment("user-2", "two@example.com"),
        assignment("user-3", "three@example.com"),
        assignment("user-4", null),
      ]) as never
    );
    // The first email never settles, as with a mail server that hangs.
    vi.mocked(sendAuditAssignedEmail).mockReturnValueOnce(
      new Promise<void>(() => {})
    );

    void sendAuditAssignedEmails({
      auditId: "audit-1",
      organizationId: "org-1",
      recipientUserIds: ["user-2", "user-3", "user-4"],
      hints,
    });
    await vi.waitFor(() => expect(sendAuditAssignedEmail).toHaveBeenCalled());

    // Everyone was pushed, including user-4 who has no email, while only the
    // first email has started.
    expect(
      vi
        .mocked(sendAuditAssignedPush)
        .mock.calls.map(([args]) => args.assigneeUserId)
    ).toEqual(["user-2", "user-3", "user-4"]);
    expect(emailedUserIds()).toEqual(["user-2"]);
  });

  it("skips an assignee who has no email address", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(
      auditWith([
        assignment("user-2", null),
        assignment("user-3", ""),
        assignment("user-4", "four@example.com"),
      ]) as never
    );

    await sendAuditAssignedEmails({
      auditId: "audit-1",
      organizationId: "org-1",
      recipientUserIds: ["user-2", "user-3", "user-4"],
      hints,
    });

    expect(emailedUserIds()).toEqual(["user-4"]);
  });

  it("looks the audit up inside the caller's workspace", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(null);

    await sendAuditAssignedEmails({
      auditId: "audit-1",
      organizationId: "org-1",
      recipientUserIds: ["user-2"],
      hints,
    });

    expect(db.auditSession.findFirst).toHaveBeenCalledWith({
      where: { id: "audit-1", organizationId: "org-1" },
      include: AUDIT_INCLUDE_FOR_EMAIL,
    });
    // An audit outside the workspace resolves to nothing, so nobody is emailed.
    expect(sendAuditAssignedEmail).not.toHaveBeenCalled();
  });

  it("makes no query when there is nobody to email", async () => {
    await sendAuditAssignedEmails({
      auditId: "audit-1",
      organizationId: "org-1",
      recipientUserIds: [],
      hints,
    });

    expect(db.auditSession.findFirst).not.toHaveBeenCalled();
    expect(sendAuditAssignedEmail).not.toHaveBeenCalled();
  });

  it("logs a rejected send and does not rethrow", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(
      auditWith([assignment("user-2", "two@example.com")]) as never
    );
    const smtpDown = new Error("SMTP unavailable");
    vi.mocked(sendAuditAssignedEmail).mockRejectedValueOnce(smtpDown);

    await expect(
      sendAuditAssignedEmails({
        auditId: "audit-1",
        organizationId: "org-1",
        recipientUserIds: ["user-2"],
        hints,
      })
    ).resolves.toBeUndefined();

    expect(Logger.error).toHaveBeenCalledTimes(1);
    expect(Logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: smtpDown,
        message: "Failed to send audit assignment emails",
        additionalData: {
          auditId: "audit-1",
          organizationId: "org-1",
          recipients: ["user-2"],
        },
      })
    );
  });

  it("logs a failed audit lookup and does not rethrow", async () => {
    vi.mocked(db.auditSession.findFirst).mockRejectedValueOnce(
      new Error("connection lost")
    );

    await expect(
      sendAuditAssignedEmails({
        auditId: "audit-1",
        organizationId: "org-1",
        recipientUserIds: ["user-2"],
        hints,
      })
    ).resolves.toBeUndefined();

    expect(Logger.error).toHaveBeenCalledTimes(1);
    expect(sendAuditAssignedEmail).not.toHaveBeenCalled();
  });
});
