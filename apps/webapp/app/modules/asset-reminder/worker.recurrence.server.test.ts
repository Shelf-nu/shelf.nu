// @vitest-environment node
/**
 * Tests for the REMINDER handler's recurring-series behavior: the stale-job
 * guard, advancing a due series before notifying, orphan recovery, retries
 * after an advance, a lost advance race, the end note, plan pauses, archived
 * assets, and advance failures reaching pg-boss.
 * The wrapper's catch/log/rethrow contract lives in `worker.server.test.ts`.
 *
 * @see {@link file://./worker.server.ts}
 */
import { ReminderRecurrenceUnit } from "@prisma/client";
import type { Mock } from "vitest";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import {
  advanceRecurringReminder,
  orgCanUseRecurringReminders,
} from "./chain.server";
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
      updateMany: vitest.fn().mockResolvedValue({ count: 1 }),
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
  orgCanUseRecurringReminders: vitest.fn().mockResolvedValue(true),
  advanceRecurringReminder: vitest.fn().mockResolvedValue({
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

type WorkerJob = {
  id?: string;
  retrycount?: number;
  data: AssetsSchedulerData;
};

/**
 * The mocked modules are `vitest.fn()` stubs fed partial rows, so they are
 * driven through the untyped `Mock` interface.
 */
const asMock = (fn: unknown) => fn as Mock;

/** Cadence fields of a monthly series in UTC. */
const MONTHLY = {
  recurrenceUnit: ReminderRecurrenceUnit.MONTH,
  recurrenceInterval: 1,
  recurrenceTimezone: "UTC",
};

/** An archived asset, for the archived-asset branch. */
const ARCHIVED_ASSET = {
  id: "asset-1",
  title: "Flow meter",
  mainImage: null,
  mainImageExpiration: null,
  archivedAt: new Date(),
};

/**
 * Extracts the internal REMINDER handler by registering the worker and
 * capturing the callback passed to scheduler.work, whose arguments are
 * (queue, options, callback).
 */
async function getWorkerHandler(): Promise<(job: WorkerJob) => Promise<void>> {
  await regierAssetWorkers();
  const workMock = scheduler.work as ReturnType<typeof vitest.fn>;
  return workMock.mock.calls[0][2];
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
      archivedAt: null,
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
  asMock(advanceRecurringReminder).mockResolvedValue({
    next: null,
    advanced: false,
    paused: false,
    ended: false,
  });
  asMock(orgCanUseRecurringReminders).mockResolvedValue(true);
});

describe("REMINDER worker handler", () => {
  it("fires a one-shot reminder: emails + note, no advance", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(buildReminderRow());

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
    asMock(db.assetReminder.findFirst).mockResolvedValue(null);

    await handler(JOB);

    expect(Logger.warn).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("skips a stale job (row tracks a different live job) without notifying or advancing", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({ activeSchedulerReference: "job-NEWER" })
    );

    await handler(JOB);

    expect(Logger.warn).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(advanceRecurringReminder).not.toHaveBeenCalled();
  });

  it("fires permissively when the stored reference is null (unknown state)", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({ activeSchedulerReference: null })
    );

    await handler(JOB);

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("advances a due recurring series BEFORE notifying and mentions the next date in the note", async () => {
    const next = new Date("2026-08-02T09:00:00.000Z");
    const callOrder: string[] = [];
    asMock(advanceRecurringReminder).mockImplementation(() => {
      callOrder.push("advance");
      return Promise.resolve({
        next,
        advanced: true,
        paused: false,
        ended: false,
      });
    });
    asMock(sendEmail).mockImplementation(() => {
      callOrder.push("email");
    });
    asMock(db.assetReminder.findFirst).mockResolvedValue(
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
    // row's active reference (self-match): the sendAfter failed on a prior
    // attempt. The worker must re-schedule that occurrence, not advance again.
    const future = new Date(Date.now() + 10 * 60_000);
    asMock(db.assetReminder.findFirst).mockResolvedValue(
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
    asMock(advanceRecurringReminder).mockResolvedValue({
      next: null,
      advanced: false,
      paused: false,
      ended: true,
    });
    asMock(db.assetReminder.findFirst).mockResolvedValue(
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

  it("sends the first occurrence after a downgrade and says later ones will not be sent", async () => {
    asMock(advanceRecurringReminder).mockResolvedValue({
      next: new Date("2099-08-02T09:00:00.000Z"),
      advanced: true,
      paused: true,
      ended: false,
    });
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow(MONTHLY)
    );

    await handler(JOB);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const note = asMock(createNote).mock.calls[0][0].content;
    expect(note).toContain("will not be sent");
    expect(note).not.toContain("Next reminder scheduled");
  });

  it("advances silently for a job scheduled while the plan lacked recurrence", async () => {
    asMock(advanceRecurringReminder).mockResolvedValue({
      next: new Date("2099-08-02T09:00:00.000Z"),
      advanced: true,
      paused: true,
      ended: false,
    });
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow(MONTHLY)
    );

    await handler({ ...JOB, data: { ...JOB.data, pausedByPlan: true } });

    expect(advanceRecurringReminder).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("notifies again once the plan includes recurrence, even for a job marked paused", async () => {
    asMock(advanceRecurringReminder).mockResolvedValue({
      next: new Date("2099-08-02T09:00:00.000Z"),
      advanced: true,
      paused: false,
      ended: false,
    });
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow(MONTHLY)
    );

    await handler({ ...JOB, data: { ...JOB.data, pausedByPlan: true } });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not notify when an edit moved the row while the job ran (lost advance)", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow(MONTHLY)
    );

    await handler(JOB);

    expect(advanceRecurringReminder).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("still notifies on a retry that follows a completed advance", async () => {
    // An earlier attempt advanced the row (so it now tracks the next job)
    // and then failed before notifying.
    const next = new Date(Date.now() + 30 * 24 * 3600_000);
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        ...MONTHLY,
        alertDateTime: next,
        activeSchedulerReference: "job-2",
      })
    );

    await handler({ ...JOB, retrycount: 1 });

    expect(advanceRecurringReminder).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(asMock(createNote).mock.calls[0][0].content).toContain(
      "Next reminder scheduled for"
    );
  });

  it("skips a first attempt whose row tracks a newer job, even for a future occurrence", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        ...MONTHLY,
        alertDateTime: new Date(Date.now() + 3600_000),
        activeSchedulerReference: "job-2",
      })
    );

    await handler(JOB);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("rethrows advance failures as RecurringAdvanceError so pg-boss retries (no email sent first)", async () => {
    asMock(advanceRecurringReminder).mockRejectedValue(new Error("boom"));
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
      })
    );

    await expect(handler(JOB)).rejects.toBeInstanceOf(RecurringAdvanceError);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("advances a recurring series on an archived asset without notifying", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
        asset: {
          id: "asset-1",
          title: "Flow meter",
          mainImage: null,
          mainImageExpiration: null,
          archivedAt: new Date(),
        },
      })
    );

    await handler(JOB);

    expect(advanceRecurringReminder).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    // The series keeps its job reference; only one-shot skips clear it.
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
  });

  it("re-arms instead of advancing when an archived series already holds a future occurrence", async () => {
    const future = new Date(Date.now() + 3600_000);
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        ...MONTHLY,
        alertDateTime: future,
        asset: ARCHIVED_ASSET,
      })
    );

    await handler(JOB);

    expect(advanceRecurringReminder).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({ when: future })
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not run the archived-asset skip for a stale job", async () => {
    asMock(db.assetReminder.findFirst).mockResolvedValue(
      buildReminderRow({
        activeSchedulerReference: "job-2",
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 1,
        asset: {
          id: "asset-1",
          title: "Flow meter",
          mainImage: null,
          mainImageExpiration: null,
          archivedAt: new Date(),
        },
      })
    );

    await handler(JOB);

    expect(advanceRecurringReminder).not.toHaveBeenCalled();
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
  });
});
