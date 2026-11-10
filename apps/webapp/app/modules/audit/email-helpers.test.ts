/**
 * Tests for the audit pushes sent beside the audit emails: who each one
 * reaches and what it says.
 *
 * @see {@link file://./email-helpers.ts}
 */
import { sendEmail } from "~/emails/mail.server";
import { sendPush } from "~/modules/push/service.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import {
  sendAuditAssignedEmail,
  sendAuditOverdueEmail,
  sendAuditReminderEmail,
} from "./email-helpers";

// @vitest-environment node

// why: sending mail is a network call; the test reads what would be sent
vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn(),
}));

// why: sendPush queues a pg-boss job; the queue and delivery are the push
// module's concern and have their own tests
vi.mock("~/modules/push/service.server", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

// why: the assignment email reads the assignee's format preferences from the
// database
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(),
}));

// why: every send logs; keep test output quiet
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), error: vi.fn() },
}));

/** A person with no format prefs of their own. */
function person(id: string, firstName: string) {
  return {
    id,
    email: `${id}@example.com`,
    firstName,
    lastName: null,
    displayName: null,
    dateFormat: null,
    timeFormat: null,
    weekStart: null,
    timeZone: null,
  };
}

const assignees = [
  { userId: "user-a", user: person("user-a", "Ana") },
  { userId: "user-b", user: person("user-b", "Ben") },
];

const audit = {
  id: "audit-1",
  name: "Q4 count",
  description: null,
  status: "ACTIVE",
  dueDate: new Date("2026-11-05T09:00:00Z"),
  organizationId: "org-1",
  organization: {
    name: "Test Org",
    customEmailFooter: null,
    owner: { email: "owner@example.com" },
  },
  _count: { assets: 3 },
  createdBy: person("creator-1", "Cora"),
  assignments: assignees,
};

const hints = { timeZone: "UTC", locale: "en-US" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendAuditAssignedEmail", () => {
  it("pushes to the assignee, with the due date in their format", async () => {
    vi.mocked(resolveUserFormatPrefsById).mockResolvedValue({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1,
      timeZone: "Europe/Berlin",
    });

    await sendAuditAssignedEmail({
      audit,
      assigneeEmail: "user-a@example.com",
      assigneeName: "Ana",
      assigneeUserId: "user-a",
      hints,
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe(
      `🔍 You've been assigned to audit: "Q4 count" - shelf.nu`
    );
    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["user-a"],
          organizationId: "org-1",
          category: "audits",
          title: `🔍 You've been assigned to audit: "Q4 count"`,
          body: "Due on 05/11/2026, 10:00",
          url: "/audits/audit-1/overview?orgId=org-1",
        },
      ],
    ]);
  });
});

describe("sendAuditReminderEmail", () => {
  it("emails each assignee and pushes once to them all", async () => {
    sendAuditReminderEmail({
      audit,
      assignees,
      hints,
      reminder: "REMINDER_4H",
    });

    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendEmail).mock.calls.map(([p]) => p.subject)).toEqual([
      `🔔 Audit due in 4 hours: "Q4 count" - shelf.nu`,
      `🔔 Audit due in 4 hours: "Q4 count" - shelf.nu`,
    ]);
    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["user-a", "user-b"],
          organizationId: "org-1",
          category: "audits",
          title: `🔔 Audit due in 4 hours: "Q4 count"`,
          body: "Complete it before it's due.",
          url: "/audits/audit-1/overview?orgId=org-1",
        },
      ],
    ]);
  });
});

describe("sendAuditOverdueEmail", () => {
  it("emails each recipient and pushes once to them all", async () => {
    sendAuditOverdueEmail({
      audit,
      recipients: [
        { ...audit.createdBy, userId: "creator-1" },
        { ...assignees[0].user, userId: "user-a" },
      ],
      hints,
    });

    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendEmail).mock.calls.map(([p]) => p.subject)).toEqual([
      `⚠️ Audit overdue: "Q4 count" - shelf.nu`,
      `⚠️ Audit overdue: "Q4 count" - shelf.nu`,
    ]);
    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["creator-1", "user-a"],
          organizationId: "org-1",
          category: "audits",
          title: `⚠️ Audit overdue: "Q4 count"`,
          body: "Complete it as soon as possible.",
          url: "/audits/audit-1/overview?orgId=org-1",
        },
      ],
    ]);
  });
});
