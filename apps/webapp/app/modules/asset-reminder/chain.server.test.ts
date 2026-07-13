// @vitest-environment node
import { ReminderRecurrenceUnit } from "@prisma/client";
import { db } from "~/database/db.server";
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

const NOW = new Date("2026-07-02T12:00:00.000Z");

function buildReminder(overrides: Record<string, unknown> = {}) {
  return {
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
  (db.assetReminder.updateMany as any).mockResolvedValue({ count: 1 });
  (db.assetReminder.findUnique as any).mockResolvedValue(null);
  (db.organization.findUnique as any).mockResolvedValue({ userId: "owner-1" });
  (getUserTierLimit as any).mockResolvedValue({
    canUseRecurringReminders: true,
  });
});

describe("advanceRecurringReminder", () => {
  it("is a no-op for one-shot reminders", async () => {
    const result = await advanceRecurringReminder({
      reminder: buildReminder({
        recurrenceUnit: null,
        recurrenceInterval: null,
      }) as any,
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
      reminder: buildReminder() as any,
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
    (db.assetReminder.updateMany as any).mockResolvedValue({ count: 0 });

    const result = await advanceRecurringReminder({
      reminder: buildReminder() as any,
      now: NOW,
    });

    expect(result.advanced).toBe(false);
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("ends the series when the next occurrence would exceed endsAt", async () => {
    const result = await advanceRecurringReminder({
      reminder: buildReminder({
        recurrenceEndsAt: new Date("2026-07-15T00:00:00.000Z"),
      }) as any,
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

  it("pauses (no reschedule) when the org tier lost the capability", async () => {
    (getUserTierLimit as any).mockResolvedValue({
      canUseRecurringReminders: false,
    });

    const result = await advanceRecurringReminder({
      reminder: buildReminder() as any,
      now: NOW,
    });

    expect(result.paused).toBe(true);
    expect(result.advanced).toBe(false);
    expect(db.assetReminder.updateMany).not.toHaveBeenCalled();
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });

  it("fails OPEN when the tier lookup errors (never kills a series on a transient)", async () => {
    (getUserTierLimit as any).mockRejectedValue(new Error("db down"));

    const result = await advanceRecurringReminder({
      reminder: buildReminder() as any,
      now: NOW,
    });

    expect(result.advanced).toBe(true);
    expect(scheduleAssetReminder).toHaveBeenCalled();
  });

  it("propagates scheduling failures (caller must retry/reconcile)", async () => {
    (scheduleAssetReminder as any).mockRejectedValue(new Error("pg-boss down"));

    await expect(
      advanceRecurringReminder({ reminder: buildReminder() as any, now: NOW })
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
    (db.assetReminder.findMany as any).mockResolvedValue([badRow, deadRow]);
    // why: first row's schedule blows up — the loop must continue to row 2
    (scheduleAssetReminder as any)
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
    (db.assetReminder.findMany as any).mockResolvedValue([row]);
    // why: advance CAS commits, then the schedule for the NEXT occurrence
    // throws; the refetched row now points at that future occurrence
    (scheduleAssetReminder as any)
      .mockRejectedValueOnce(new Error("pg-boss hiccup"))
      .mockResolvedValueOnce(undefined);
    (db.assetReminder.findUnique as any).mockResolvedValue({
      alertDateTime: new Date("2026-08-02T09:00:00.000Z"),
    });

    const { rearmed } = await reconcileRecurringReminders({ now: NOW });

    expect(rearmed).toBe(1);
    expect(scheduleAssetReminder).toHaveBeenCalledTimes(2);
    expect((scheduleAssetReminder as any).mock.calls[1][0]).toMatchObject({
      when: new Date("2026-08-02T09:00:00.000Z"),
      options: expect.objectContaining({ retryLimit: 3 }),
    });
  });

  it("skips ended-but-not-yet-expired series quietly", async () => {
    // Monthly series: last occurrence fired, endsAt is still future but the
    // NEXT occurrence would exceed it -> getNextOccurrence returns null
    const endedRow = buildReminder({
      id: "ended-1",
      alertDateTime: new Date("2026-07-01T09:00:00.000Z"),
      recurrenceEndsAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    (db.assetReminder.findMany as any).mockResolvedValue([endedRow]);

    const { scanned, rearmed } = await reconcileRecurringReminders({
      now: NOW,
    });

    expect(scanned).toBe(1);
    expect(rearmed).toBe(0);
    expect(scheduleAssetReminder).not.toHaveBeenCalled();
  });
});
