/**
 * Tests for the audit reminder and overdue jobs: each sends its emails and
 * one push, worded for that job, to the right people.
 *
 * @see {@link file://./worker.server.ts}
 */
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { sendPush } from "~/modules/push/service.server";
import { scheduler } from "~/utils/scheduler.server";
import { AUDIT_SCHEDULER_EVENTS_ENUM } from "./constants";
import type { AuditSchedulerData } from "./types";
import { registerAuditWorkers } from "./worker.server";

// @vitest-environment node

// why: the jobs load the audit from the database
vi.mock("~/database/db.server", () => ({
  db: { auditSession: { findFirstOrThrow: vi.fn() } },
}));

// why: pg-boss needs a live Postgres; the test runs the registered handler
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { auditQueue: "audit-queue" },
  scheduler: { work: vi.fn() },
}));

// why: scheduling the next reminder is a queue write this test does not cover
vi.mock("./service.server", () => ({
  scheduleNextAuditJob: vi.fn().mockResolvedValue(undefined),
}));

// why: sending mail is a network call; the test reads what would be sent
vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn(),
}));

// why: sendPush queues a pg-boss job; the queue and delivery are the push
// module's concern and have their own tests
vi.mock("~/modules/push/service.server", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
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

describe("audit reminder and overdue jobs", () => {
  let runJob: (job: { data: AuditSchedulerData }) => Promise<void>;

  beforeAll(async () => {
    await registerAuditWorkers();
    const workMock = scheduler.work as ReturnType<typeof vi.fn>;
    runJob = workMock.mock.calls[0][1];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error partial audit row for the email include
    vi.mocked(db.auditSession.findFirstOrThrow).mockResolvedValue(audit);
  });

  it.each([
    [
      AUDIT_SCHEDULER_EVENTS_ENUM.reminder24h,
      "🔔 Audit due in 24 hours",
      `🔔 Audit due in 24 hours: "Q4 count"`,
    ],
    [
      AUDIT_SCHEDULER_EVENTS_ENUM.reminder4h,
      "🔔 Audit due in 4 hours",
      `🔔 Audit due in 4 hours: "Q4 count"`,
    ],
    [
      AUDIT_SCHEDULER_EVENTS_ENUM.reminder1h,
      "🔔 Audit due in 1 hour",
      `🔔 Audit due in 1 hour: "Q4 count"`,
    ],
  ])(
    "%s emails and pushes the assignees",
    async (eventType, heading, pushTitle) => {
      await runJob({ data: { id: "audit-1", hints, eventType } });

      await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(2));
      expect(vi.mocked(sendEmail).mock.calls.map(([p]) => p.subject)).toEqual([
        `${heading}: "Q4 count" - shelf.nu`,
        `${heading}: "Q4 count" - shelf.nu`,
      ]);
      expect(vi.mocked(sendPush).mock.calls).toEqual([
        [
          {
            userIds: ["user-a", "user-b"],
            organizationId: "org-1",
            category: "audits",
            title: pushTitle,
            body: "Complete it before it's due.",
            url: "/audits/audit-1/overview?orgId=org-1",
          },
        ],
      ]);
    }
  );

  it("sends the overdue notice once to a creator who is also an assignee", async () => {
    const overdue = { ...audit, createdBy: assignees[0].user };
    // @ts-expect-error partial audit row for the email include
    vi.mocked(db.auditSession.findFirstOrThrow).mockResolvedValue(overdue);

    await runJob({
      data: {
        id: "audit-1",
        hints,
        eventType: AUDIT_SCHEDULER_EVENTS_ENUM.overdueNotice,
      },
    });

    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["user-a", "user-b"],
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
