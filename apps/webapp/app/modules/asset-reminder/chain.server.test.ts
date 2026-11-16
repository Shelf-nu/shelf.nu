// @vitest-environment node
/**
 * Tests for the recurring-reminder chain: the compare-and-swap advance, the
 * plan pause, and boot reconciliation of dead chains.
 *
 * @see {@link file://./chain.server.ts}
 */
import { ReminderRecurrenceUnit } from "@prisma/client";
import type { Mock } from "vitest";
import { db } from "~/database/db.server";
import { scheduler } from "~/utils/scheduler.server";
import {
  advanceRecurringReminder,
  reconcileRecurringReminders,
  RECONCILE_GRACE_MS,
} from "./chain.server";
import { scheduleAssetReminder } from "./scheduler.server";

// why: testing chain logic without a real database
vitest.mock("~/database/db.server", () => ({
  db: {
    assetReminder: {
      updateMany: vitest.fn().mockResolvedValue({ count: 1 }),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    organization: {
      findUnique: vitest.fn().mockResolvedValue({ userId: "owner-1" }),
    },
  },
}));

// why: preventing real pg-boss scheduling; recurringReminderJobOptions stays
// real so option shapes are asserted end-to-end
vitest.mock("./scheduler.server", async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    scheduleAssetReminder: vitest.fn().mockResolvedValue(undefined),
  };
});

// why: reconciliation asks pg-boss whether a row's job is still live
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: { getJobById: vitest.fn().mockResolvedValue(null) },
  QueueNames: { assetsQueue: "assets-queue" },
}));

// why: tier resolution hits the database; the capability flag is the input
// under test
vitest.mock("../tier/service.server", () => ({
  getUserTierLimit: vitest.fn().mockResolvedValue({
    canUseRecurringReminders: true,
  }),
}));

// why: subscription helpers read premium config from env at import time
vitest.mock("~/utils/subscription.server", () => ({
  canUseRecurringReminders: vitest.fn(
    (tierLimit: { canUseRecurringReminders: boolean } | null) =>
      tierLimit?.canUseRecurringReminders ?? false
  ),
}));

// why: spying on logging without side effects
vitest.mock("~/utils/logger", () => ({
  Logger: { warn: vitest.fn(), info: vitest.fn(), error: vitest.fn() },
}));

const { getUserTierLimit } = await import("../tier/service.server");

/**
 * The mocked modules are `vitest.fn()` stubs fed partial rows, so they are
 * driven through the untyped `Mock` interface.
 */
const asMock = (fn: unknown) => fn as Mock;

const NOW = new Date("2026-07-02T12:00:00.000Z");

/** The reminder shape advanceRecurringReminder reads. */
type ChainReminder = Parameters<typeof advanceRecurringReminder>[0]["reminder"];

function buildReminder(
  overrides: Partial<ChainReminder> & { activeSchedulerReference?: string } = {}
): ChainReminder & { activeSchedulerReference: string | null } {
  return {
    activeSchedulerReference: null,
    id: "reminder-1",
    organizationId: "org-1",
    alertDateTime: new Date("2026-07-02T11:59:00.000Z"),
    recurrenceUnit: ReminderRecurrenceUnit.MONTH,
    recurrenceInterval: 1,
    recurrenceTimezone: "UTC",
    recurrenceEndsAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vitest.clearAllMocks();
  asMock(db.assetReminder.updateMany).mockResolvedValue({ count: 1 });
  asMock(db.assetReminder.findUnique).mockResolvedValue(null);
  asMock(db.organization.findUnique).mockResolvedValue({ userId: "owner-1" });
  asMock(getUserTierLimit).mockResolvedValue({
    canUseRecurringReminders: true,
  });
  asMock(scheduler.getJobById).mockResolvedValue(null);
  // why: a test above leaves a persistent rejection on the schedule stub
  asMock(scheduleAssetReminder).mockResolvedValue(undefined);
});

describe("advanceRecurringReminder", () => {
  it("is a no-op for one-shot reminders", async () => {
    const result = await advanceRecurringReminder({
      reminder: buildReminder({
        recurrenceUnit: null,
        recurrenceInterval: null,
      }),
      now: NOW,
    });

    expect(result).toEqual({
      next: null,
      advanced: false,
      paused: false,
      ended: false,
    });
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("advances the row via CAS and schedules the next job with retry + singleton options", async () => {
    const result = await advanceRecurringReminder({
      reminder: buildReminder(),
      now: NOW,
    });

    const expectedNext = new Date("2026-08-02T11:59:00.000Z");
    expect(result.advanced).toBe(true);
    expect(result.next?.toISOString()).toBe(expectedNext.toISOString());

    // CAS: the update is guarded on the OLD alertDateTime
    expect(db.assetReminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reminder-1",
        organizationId: "org-1",
        alertDateTime: new Date("2026-07-02T11:59:00.000Z"),
      },
      data: { alertDateTime: expectedNext },
    });

    expect(scheduleAssetReminder).toHaveBeenCalledWith({
      data: { reminderId: "reminder-1", eventType: "REMINDER" },
      when: expectedNext,
      options: {
        retryLimit: 3,
        retryBackoff: true,
        singletonKey: `asset-reminder-reminder-1-${expectedNext.toISOString()}`,
      },
    });
  });

  it("stops without scheduling when a concurrent actor wins the CAS", async () => {
    asMock(db.assetReminder.updateMany).mockResolvedValue({ count: 0 });

    const result = await advanceRecurringReminder({
      reminder: buildReminder(),
      now: NOW,
    });

    expect(result.advanced).toBe(false);
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("ends the series when the next occurrence would exceed endsAt", async () => {
    const result = await advanceRecurringReminder({
      reminder: buildReminder({
        recurrenceEndsAt: new Date("2026-07-15T00:00:00.000Z"),
      }),
      now: NOW,
    });

    expect(result).toEqual({
      next: null,
      advanced: false,
      paused: false,
      ended: true,
    });
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("keeps a series moving when the plan lost the capability, marking the next job paused", async () => {
    asMock(getUserTierLimit).mockResolvedValue({
      canUseRecurringReminders: false,
    });

    const result = await advanceRecurringReminder({
      reminder: buildReminder(),
      now: NOW,
    });

    expect(result).toMatchObject({ advanced: true, paused: true });
    expect(db.assetReminder.updateMany).toHaveBeenCalledTimes(1);
    expect(scheduleAssetReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pausedByPlan: true }),
      })
    );
  });

  it("schedules an unmarked job when the plan includes recurrence", async () => {
    await advanceRecurringReminder({ reminder: buildReminder(), now: NOW });

    expect(
      asMock(scheduleAssetReminder).mock.calls[0][0].data.pausedByPlan
    ).toBeUndefined();
  });

  it("fails OPEN when the tier lookup errors (never kills a series on a transient)", async () => {
    asMock(getUserTierLimit).mockRejectedValue(new Error("db down"));

    const result = await advanceRecurringReminder({
      reminder: buildReminder(),
      now: NOW,
    });

    expect(result.advanced).toBe(true);
    expect(scheduleAssetReminder).toHaveBeenCalled();
  });

  it("propagates scheduling failures (caller must retry/reconcile)", async () => {
    asMock(scheduleAssetReminder).mockRejectedValue(new Error("pg-boss down"));

    await expect(
      advanceRecurringReminder({ reminder: buildReminder(), now: NOW })
    ).rejects.toThrow("pg-boss down");
  });
});

describe("reconcileRecurringReminders", () => {
  it("only claims chains dead for longer than the grace window", async () => {
    await reconcileRecurringReminders({ now: NOW });

    expect(db.assetReminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recurrenceUnit: { not: null },
          alertDateTime: {
            lt: new Date(NOW.getTime() - RECONCILE_GRACE_MS),
          },
        }),
      })
    );
  });

  it("re-arms dead chains and isolates per-row failures", async () => {
    const deadRow = buildReminder({
      id: "dead-1",
      alertDateTime: new Date("2026-07-02T09:00:00.000Z"),
    });
    const badRow = buildReminder({
      id: "bad-1",
      alertDateTime: new Date("2026-07-02T08:00:00.000Z"),
    });
    asMock(db.assetReminder.findMany).mockResolvedValue([badRow, deadRow]);
    // why: first row's schedule blows up: the loop must continue to row 2
    asMock(scheduleAssetReminder)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const { scanned, rearmed } = await reconcileRecurringReminders({
      now: NOW,
    });

    expect(scanned).toBe(2);
    expect(rearmed).toBe(1);
    expect(scheduleAssetReminder).toHaveBeenCalledTimes(2);
  });

  it("re-arms the row's current occurrence when the CAS committed but scheduling failed", async () => {
    const row = buildReminder({
      id: "orphan-1",
      alertDateTime: new Date("2026-07-02T09:00:00.000Z"),
    });
    asMock(db.assetReminder.findMany).mockResolvedValue([row]);
    // why: advance CAS commits, then the schedule for the NEXT occurrence
    // throws; the refetched row now points at that future occurrence
    asMock(scheduleAssetReminder)
      .mockRejectedValueOnce(new Error("pg-boss hiccup"))
      .mockResolvedValueOnce(undefined);
    asMock(db.assetReminder.findUnique).mockResolvedValue({
      alertDateTime: new Date("2026-08-02T09:00:00.000Z"),
    });

    const { rearmed } = await reconcileRecurringReminders({ now: NOW });

    expect(rearmed).toBe(1);
    expect(scheduleAssetReminder).toHaveBeenCalledTimes(2);
    expect(asMock(scheduleAssetReminder).mock.calls[1][0]).toMatchObject({
      when: new Date("2026-08-02T09:00:00.000Z"),
      options: expect.objectContaining({ retryLimit: 3 }),
    });
  });

  it("leaves a series alone while its job is still queued or running", async () => {
    asMock(db.assetReminder.findMany).mockResolvedValue([
      buildReminder({
        alertDateTime: new Date("2026-07-02T09:00:00.000Z"),
        activeSchedulerReference: "job-queued",
      }),
    ]);
    asMock(scheduler.getJobById).mockResolvedValue({ state: "created" });

    const { rearmed } = await reconcileRecurringReminders({ now: NOW });

    expect(rearmed).toBe(0);
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("re-arms a series whose job has finished without advancing it", async () => {
    asMock(db.assetReminder.findMany).mockResolvedValue([
      buildReminder({
        alertDateTime: new Date("2026-07-02T09:00:00.000Z"),
        activeSchedulerReference: "job-failed",
      }),
    ]);
    asMock(scheduler.getJobById).mockResolvedValue({ state: "failed" });

    const { rearmed } = await reconcileRecurringReminders({ now: NOW });

    expect(rearmed).toBe(1);
    expect(scheduleAssetReminder).toHaveBeenCalledTimes(1);
  });

  it("looks the plan up once per organization", async () => {
    asMock(db.assetReminder.findMany).mockResolvedValue([
      buildReminder({
        id: "a",
        alertDateTime: new Date("2026-07-02T09:00:00.000Z"),
      }),
      buildReminder({
        id: "b",
        alertDateTime: new Date("2026-07-02T08:00:00.000Z"),
      }),
    ]);

    await reconcileRecurringReminders({ now: NOW });

    expect(getUserTierLimit).toHaveBeenCalledTimes(1);
  });

  it("skips ended-but-not-yet-expired series quietly", async () => {
    // Monthly series: last occurrence fired, endsAt is still future but the
    // NEXT occurrence would exceed it -> getNextOccurrence returns null
    const endedRow = buildReminder({
      id: "ended-1",
      alertDateTime: new Date("2026-07-01T09:00:00.000Z"),
      recurrenceEndsAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    asMock(db.assetReminder.findMany).mockResolvedValue([endedRow]);

    const { scanned, rearmed } = await reconcileRecurringReminders({
      now: NOW,
    });

    expect(scanned).toBe(1);
    expect(rearmed).toBe(0);
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });
});
