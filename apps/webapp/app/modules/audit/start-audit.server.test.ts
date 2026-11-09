/**
 * Unit tests for the shared start-audit orchestration.
 *
 * Pins what every entry point relies on: the due date is parsed in the
 * caller's timezone and refused when past, the assignee is emailed only when
 * someone other than the creator was chosen, and the first reminder that is
 * still ahead is the one scheduled.
 *
 * @see {@link file://./start-audit.server.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_SCHEDULER_EVENTS_ENUM } from "./constants";
import { startAudit } from "./start-audit.server";

const mocks = vi.hoisted(() => ({
  createAuditSession: vi.fn(),
  scheduleNextAuditJob: vi.fn(),
  sendAuditAssignedEmail: vi.fn(),
  auditSessionFindFirst: vi.fn(),
}));

// why: the session write and the job queue are external; assert their inputs.
vi.mock("./service.server", () => ({
  createAuditSession: mocks.createAuditSession,
  scheduleNextAuditJob: mocks.scheduleNextAuditJob,
}));

// why: no mail leaves a unit test; assert the recipient instead.
vi.mock("./email-helpers", () => ({
  sendAuditAssignedEmail: mocks.sendAuditAssignedEmail,
}));

// why: the assignee lookup for the email reads the database.
vi.mock("~/database/db.server", () => ({
  db: { auditSession: { findFirst: mocks.auditSessionFindFirst } },
}));

const hints = { timeZone: "Europe/Moscow", locale: "en-US" };

/** Arguments for one call, with a self-assigned audit and no due date. */
function args(overrides: Partial<Parameters<typeof startAudit>[0]> = {}) {
  return {
    name: "Quarterly warehouse audit",
    assetIds: ["asset-1"],
    userId: "user-1",
    organizationId: "org-1",
    hints,
    resolveTimeZone: vi.fn().mockResolvedValue("Europe/London"),
    ...overrides,
  };
}

describe("startAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-07-01T12:00:00.000Z"));
    mocks.createAuditSession.mockImplementation(
      ({ dueDate }: { dueDate?: Date }) =>
        Promise.resolve({
          session: { id: "audit-1", dueDate: dueDate ?? null },
        })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses the due date in the caller's timezone and schedules the 24h reminder", async () => {
    const resolveTimeZone = vi.fn().mockResolvedValue("Europe/London");

    const result = await startAudit(
      args({ dueDateString: "2099-07-20T15:48", resolveTimeZone })
    );

    expect(result).toEqual({ sessionId: "audit-1", isAssignedToOther: false });
    // London BST (UTC+1): 15:48 local is 14:48Z, not the Moscow hint's 12:48Z.
    const persisted = mocks.createAuditSession.mock.calls[0][0].dueDate as Date;
    expect(persisted.toISOString()).toBe("2099-07-20T14:48:00.000Z");
    expect(resolveTimeZone).toHaveBeenCalledTimes(1);

    expect(mocks.scheduleNextAuditJob).toHaveBeenCalledWith({
      data: {
        id: "audit-1",
        hints,
        eventType: AUDIT_SCHEDULER_EVENTS_ENUM.reminder24h,
      },
      when: new Date("2099-07-19T14:48:00.000Z"),
    });
  });

  it("schedules the overdue notice when the due date is within the hour", async () => {
    await startAudit(args({ dueDateString: "2099-07-01T13:30" }));

    expect(mocks.scheduleNextAuditJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice,
        }),
      })
    );
  });

  it("refuses a due date that is not in the future, before creating anything", async () => {
    await expect(
      startAudit(args({ dueDateString: "2099-06-30T10:00" }))
    ).rejects.toMatchObject({
      status: 400,
      additionalData: {
        validationErrors: { dueDate: { message: expect.any(String) } },
      },
    });

    expect(mocks.createAuditSession).not.toHaveBeenCalled();
  });

  it("neither parses a timezone nor schedules reminders without a due date", async () => {
    const resolveTimeZone = vi.fn();

    await startAudit(args({ resolveTimeZone }));

    expect(resolveTimeZone).not.toHaveBeenCalled();
    expect(mocks.scheduleNextAuditJob).not.toHaveBeenCalled();
    expect(mocks.createAuditSession.mock.calls[0][0].dueDate).toBeUndefined();
  });

  it("emails an assignee who is not the creator", async () => {
    mocks.auditSessionFindFirst.mockResolvedValue({
      id: "audit-1",
      assignments: [
        {
          userId: "user-2",
          user: {
            email: "sam@example.com",
            firstName: "Sam",
            lastName: "Lee",
            displayName: null,
          },
        },
      ],
    });

    const result = await startAudit(args({ assignee: "user-2" }));

    expect(result.isAssignedToOther).toBe(true);
    expect(mocks.auditSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit-1", organizationId: "org-1" },
      })
    );
    expect(mocks.sendAuditAssignedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeEmail: "sam@example.com",
        assigneeName: "Sam Lee",
        assigneeUserId: "user-2",
        hints,
      })
    );
  });

  it("sends no email when the creator assigned the audit to themself", async () => {
    const result = await startAudit(args({ assignee: "user-1" }));

    expect(result.isAssignedToOther).toBe(false);
    expect(mocks.auditSessionFindFirst).not.toHaveBeenCalled();
    expect(mocks.sendAuditAssignedEmail).not.toHaveBeenCalled();
  });
});
