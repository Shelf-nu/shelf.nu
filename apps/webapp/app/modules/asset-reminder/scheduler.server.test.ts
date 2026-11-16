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
import {
  findUndeliveredReminderJobIds,
  scheduleAssetReminder,
} from "./scheduler.server";

// @vitest-environment node

// why: asserting the DB write without touching a real database
vi.mock("~/database/db.server", () => ({
  db: {
    assetReminder: {
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn(),
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

/**
 * Builds a `scheduleAssetReminder` input with sensible defaults, so each test
 * only states the fields it actually cares about.
 *
 * @param overrides - Partial fields to override the defaults.
 * @returns The `{ data, when }` argument for `scheduleAssetReminder`.
 */
function buildScheduleInput(
  overrides: Partial<Parameters<typeof scheduleAssetReminder>[0]> = {}
): Parameters<typeof scheduleAssetReminder>[0] {
  return {
    data: { reminderId: "reminder-1", eventType: "REMINDER" as const },
    when: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("scheduleAssetReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues with a bounded retry policy (retryLimit + retryDelay)", async () => {
    const input = buildScheduleInput();

    await scheduleAssetReminder(input);

    expect(scheduler.sendAfter).toHaveBeenCalledWith(
      QueueNames.assetsQueue,
      input.data,
      { retryLimit: 2, retryDelay: 60 },
      input.when
    );
  });

  it("persists the returned scheduler reference on the reminder", async () => {
    await scheduleAssetReminder(buildScheduleInput());

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
      scheduleAssetReminder(buildScheduleInput())
    ).rejects.toMatchObject({
      message: "Something went wrong while schedulng asset alert",
    });
  });
});

describe("findUndeliveredReminderJobIds", () => {
  const JOB = "c4d70d00-74c1-4251-99c1-c2ec46614023";

  beforeEach(() => {
    vi.mocked(db.$queryRaw).mockReset();
  });

  it("asks pg-boss's job table for live states only", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: JOB }] as never);

    const live = await findUndeliveredReminderJobIds([JOB]);

    expect(live).toEqual(new Set([JOB]));
    const [strings, ids, states] = vi.mocked(db.$queryRaw).mock.calls[0] as [
      TemplateStringsArray,
      string[],
      string[],
    ];
    expect(strings.join("?")).toContain("FROM pgboss.job");
    expect(ids).toEqual([JOB]);
    expect(states).toEqual(["created", "retry", "active"]);
  });

  it("skips the query when no id can be a pg-boss job", async () => {
    expect(await findUndeliveredReminderJobIds(["not-a-uuid"])).toEqual(
      new Set()
    );
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
