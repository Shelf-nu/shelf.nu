/**
 * Tests for the asset-reminder scheduler enqueue helpers.
 *
 * Focus: `scheduleAssetReminder` must pass a bounded retry policy to
 * pg-boss's `sendAfter` — previously `{}` was passed, so even after
 * `regierAssetWorkers` started rethrowing on failure, pg-boss had no retry
 * configured and the job would still be lost on first failure.
 *
 * @see {@link file://./scheduler.server.ts}
 */
import { db } from "~/database/db.server";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { scheduleAssetReminder } from "./scheduler.server";

// @vitest-environment node

// why: asserting the DB write without touching a real database
vi.mock("~/database/db.server", () => ({
  db: {
    assetReminder: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// why: capturing the arguments passed to pg-boss without scheduling a real job
vi.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    sendAfter: vi.fn().mockResolvedValue("scheduler-ref-1"),
  },
  QueueNames: {
    assetsQueue: "assets-queue",
  },
}));

describe("scheduleAssetReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues with a bounded retry policy (retryLimit + retryDelay)", async () => {
    const data = {
      reminderId: "reminder-1",
      eventType: "REMINDER" as const,
    };
    const when = new Date("2026-01-01T00:00:00Z");

    await scheduleAssetReminder({ data, when });

    expect(scheduler.sendAfter).toHaveBeenCalledWith(
      QueueNames.assetsQueue,
      data,
      { retryLimit: 2, retryDelay: 60 },
      when
    );
  });

  it("persists the returned scheduler reference on the reminder", async () => {
    const data = {
      reminderId: "reminder-1",
      eventType: "REMINDER" as const,
    };
    const when = new Date("2026-01-01T00:00:00Z");

    await scheduleAssetReminder({ data, when });

    expect(db.assetReminder.update).toHaveBeenCalledWith({
      where: { id: "reminder-1" },
      data: { activeSchedulerReference: "scheduler-ref-1" },
    });
  });

  it("wraps a sendAfter failure in a ShelfError", async () => {
    const cause = new Error("pg-boss unavailable");
    // @ts-expect-error missing vitest type
    scheduler.sendAfter.mockRejectedValue(cause);

    await expect(
      scheduleAssetReminder({
        data: { reminderId: "reminder-1", eventType: "REMINDER" },
        when: new Date("2026-01-01T00:00:00Z"),
      })
    ).rejects.toMatchObject({
      message: "Something went wrong while schedulng asset alert",
    });
  });
});
