// @vitest-environment node
import { ReminderRecurrenceUnit } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import { advanceRecurringReminder } from "./chain.server";
import {
  scheduleAssetReminder,
  type AssetsSchedulerData,
} from "./scheduler.server";
import { regierAssetWorkers, RecurringAdvanceError } from "./worker.server";
import { createNote } from "../note/service.server";

// why: testing the worker handler without a real database
vitest.mock("~/database/db.server", () => ({
  db: {
    assetReminder: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    user: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: preventing real pg-boss registration; the handler is extracted from
// the work() mock
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    work: vitest.fn(),
    cancel: vitest.fn(),
    sendAfter: vitest.fn(),
  },
  QueueNames: {
    assetsQueue: "assets-queue",
  },
}));

// why: the advance step is unit-tested in chain.server.test.ts; here we only
// verify the worker calls it at the right time and handles its outcomes
vitest.mock("./chain.server", () => ({
  ADVANCE_CLOCK_EPSILON_MS: 60 * 1000,
  advanceRecurringReminder: vitest
    .fn()
    .mockResolvedValue({
      next: null,
      advanced: false,
      paused: false,
      ended: false,
    }),
}));

// why: asserting the orphan-recovery branch re-arms the pending occurrence
// without invoking the full scheduler
vitest.mock("./scheduler.server", async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    scheduleAssetReminder: vitest.fn().mockResolvedValue(undefined),
  };
});

// why: preventing real email template rendering during tests
vitest.mock("./emails", () => ({
  assetAlertEmailHtmlString: vitest.fn().mockResolvedValue("<html></html>"),
  assetAlertEmailText: vitest.fn().mockReturnValue("text"),
}));

// why: preventing actual email sending during tests
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: preventing actual note creation during worker tests
vitest.mock("../note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
}));

// why: spying on Logger to verify warn/skip behavior without side effects
vitest.mock("~/utils/logger", () => ({
  Logger: { warn: vitest.fn(), info: vitest.fn(), error: vitest.fn() },
}));

type WorkerJob = { id?: string; data: AssetsSchedulerData };

/**
 * Extracts the internal REMINDER handler by registering the worker and
 * capturing the callback passed to scheduler.work (same pattern as the
 * booking worker tests).
 */
async function getWorkerHandler(): Promise<(job: WorkerJob) => Promise<void>> {
  await regierAssetWorkers();
  const workMock = scheduler.work as ReturnType<typeof vitest.fn>;
  return workMock.mock.calls[0][1];
}

function buildReminderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder-1",
    name: "Calibrate flow meter",
    message: "Quarterly calibration",
    organizationId: "org-1",
    assetId: "asset-1",
    createdById: "user-1",
    alertDateTime: new Date(Date.now() - 60_000),
    activeSchedulerReference: "job-1",
    recurrenceUnit: null,
    recurrenceInterval: null,
    recurrenceTimezone: null,
    recurrenceEndsAt: null,
    teamMembers: [
      {
        user: {
          email: "tech@example.com",
          firstName: "Tess",
          lastName: "Tech",
          displayName: "Tess Tech",
        },
      },
    ],
    asset: {
      id: "asset-1",
      title: "Flow meter",
      mainImage: null,
      mainImageExpiration: null,
    },
    organization: { name: "Acme", customEmailFooter: null },
    ...overrides,
  };
}

const JOB: WorkerJob = {
  id: "job-1",
  data: { reminderId: "reminder-1", eventType: "REMINDER" },
};

let handler: (job: WorkerJob) => Promise<void>;

beforeAll(async () => {
  handler = await getWorkerHandler();
});

beforeEach(() => {
  vitest.clearAllMocks();
  (advanceRecurringReminder as any).mockResolvedValue({
    next: null,
    advanced: false,
    paused: false,
    ended: false,
  });
});

describe("REMINDER worker handler", () => {
  it("fires a one-shot reminder: emails + note, no advance", async () => {
    (db.assetReminder.findFirst as any).mockResolvedValue(buildReminderRow());

    await handler(JOB);

    expect(advanceRecurringReminder).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "**System** has sent **Calibrate flow meter** reminder.",
      })
    );
  });

  it("skips silently when the reminder row is gone (deleted asset/reminder)", async () => {
    (db.assetReminder.findFirst as any).mockResolvedValue(null);

    await handler(JOB);

    expect(Logger.warn).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("skips a stale job (row tracks a different live job) without notifying or advancing", async () => {
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({ activeSchedulerReference: "job-NEWER" })
    );

    await handler(JOB);

    expect(Logger.warn).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(advanceRecurringReminder).not.toHaveBeenCalled();
  });

  it("fires permissively when the stored reference is null (unknown state)", async () => {
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({ activeSchedulerReference: null })
    );

    await handler(JOB);

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("advances a due recurring series BEFORE notifying and mentions the next date in the note", async () => {
    const next = new Date("2026-08-02T09:00:00.000Z");
    const callOrder: string[] = [];
    (advanceRecurringReminder as any).mockImplementation(() => {
      callOrder.push("advance");
      return Promise.resolve({
        next,
        advanced: true,
        paused: false,
        ended: false,
      });
    });
    (sendEmail as any).mockImplementation(() => {
      callOrder.push("email");
    });
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
        recurrenceTimezone: "UTC",
      })
    );

    await handler(JOB);

    expect(callOrder[0]).toBe("advance");
    expect(callOrder).toContain("email");
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Next reminder scheduled for"),
      })
    );
  });

  it("re-arms an orphaned occurrence on retry (row advanced but next job never scheduled)", async () => {
    // The row already points at a future occurrence, and THIS job is still the
    // row's active reference (self-match) — the sendAfter failed on a prior
    // attempt. The worker must re-schedule that occurrence, not advance again.
    const future = new Date(Date.now() + 10 * 60_000);
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
        alertDateTime: future,
        activeSchedulerReference: "job-1", // == JOB.id (not stale)
      })
    );

    await handler(JOB);

    expect(advanceRecurringReminder).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        when: future,
        options: expect.objectContaining({ retryLimit: 3 }),
      })
    );
    // the fired occurrence still notifies (at-least-once)
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("notes the final occurrence when the series ends (end date reached)", async () => {
    (advanceRecurringReminder as any).mockResolvedValue({
      next: null,
      advanced: false,
      paused: false,
      ended: true,
    });
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
      })
    );

    await handler(JOB);

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("last occurrence"),
      })
    );
  });

  it("notes the pause when the workspace tier lost recurrence", async () => {
    (advanceRecurringReminder as any).mockResolvedValue({
      next: null,
      advanced: false,
      paused: true,
      ended: false,
    });
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
      })
    );

    await handler(JOB);

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("paused"),
      })
    );
  });

  it("rethrows advance failures as RecurringAdvanceError so pg-boss retries (no email sent first)", async () => {
    (advanceRecurringReminder as any).mockRejectedValue(new Error("boom"));
    (db.assetReminder.findFirst as any).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
      })
    );

    await expect(handler(JOB)).rejects.toBeInstanceOf(RecurringAdvanceError);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});
