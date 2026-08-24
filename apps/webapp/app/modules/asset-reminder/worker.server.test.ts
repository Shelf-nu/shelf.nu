/**
 * Tests for the asset-reminder pg-boss worker.
 *
 * Focus: the worker-wrapping behavior around `regierAssetWorkers` — the
 * catch/log/rethrow contract that determines whether pg-boss retries a
 * failed reminder job or silently marks it COMPLETED. The handler is
 * exercised through the callback captured from `scheduler.work`, since the
 * event handlers themselves are not exported.
 *
 * @see {@link file://./worker.server.ts}
 */
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import type { AssetsSchedulerData } from "./scheduler.server";
import { regierAssetWorkers } from "./worker.server";

// @vitest-environment node

// why: testing worker handlers without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    assetReminder: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

// why: preventing actual job scheduling during tests; captures the
// registered callback + options so we can invoke it directly below
vi.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    work: vi.fn(),
  },
  QueueNames: {
    assetsQueue: "assets-queue",
  },
}));

// why: preventing actual email rendering/sending during worker tests
vi.mock("./emails", () => ({
  assetAlertEmailHtmlString: vi.fn().mockResolvedValue("<html></html>"),
  assetAlertEmailText: vi.fn().mockReturnValue("text body"),
}));

// why: preventing real email delivery while exercising the worker's
// failure/retry paths — the tests assert on rethrow + logging, not on email I/O
vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn(),
}));

// why: avoiding actual note creation during worker tests
vi.mock("../note/service.server", () => ({
  createNote: vi.fn().mockResolvedValue({}),
}));

// why: spying on Logger to verify logging behavior without touching Sentry/pino
vi.mock("~/utils/logger", () => ({
  Logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Helper mirroring `apps/webapp/app/modules/booking/worker.server.test.ts`:
 * registers the worker and extracts the callback pg-boss would invoke per
 * job, since `ASSET_SCHEDULER_EVENT_HANDLERS` is module-private.
 */
async function getWorkerHandler(): Promise<{
  handler: (job: PgBoss.JobWithMetadata<AssetsSchedulerData>) => Promise<void>;
  queueName: unknown;
  options: unknown;
}> {
  await regierAssetWorkers();
  const workMock = scheduler.work as ReturnType<typeof vi.fn>;
  // scheduler.work is called with (queueName, options, callback). Captured
  // here (rather than read from workMock.mock.calls in a test body) because
  // beforeEach clears mock call history between tests below.
  const [queueName, options, handler] = workMock.mock.calls[0];
  return { handler, queueName, options };
}

function buildJob(
  overrides: Partial<PgBoss.JobWithMetadata<AssetsSchedulerData>> = {}
): PgBoss.JobWithMetadata<AssetsSchedulerData> {
  return {
    id: "job-1",
    name: QueueNames.assetsQueue,
    data: { reminderId: "reminder-1", eventType: "REMINDER" },
    retrycount: 0,
    retrylimit: 2,
    ...overrides,
  } as PgBoss.JobWithMetadata<AssetsSchedulerData>;
}

describe("regierAssetWorkers", () => {
  let workerHandler: (
    job: PgBoss.JobWithMetadata<AssetsSchedulerData>
  ) => Promise<void>;
  let registeredQueueName: unknown;
  let registeredOptions: unknown;

  beforeAll(async () => {
    const registration = await getWorkerHandler();
    workerHandler = registration.handler;
    registeredQueueName = registration.queueName;
    registeredOptions = registration.options;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the queue with includeMetadata so retrycount/retrylimit are available", () => {
    expect(registeredQueueName).toBe(QueueNames.assetsQueue);
    expect(registeredOptions).toEqual(
      expect.objectContaining({ includeMetadata: true })
    );
  });

  it("returns cleanly (no throw) when the reminder no longer exists", async () => {
    // @ts-expect-error missing vitest type
    db.assetReminder.findFirst.mockResolvedValue(null);

    await expect(workerHandler(buildJob())).resolves.toBeUndefined();

    expect(Logger.warn).toHaveBeenCalled();
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("rethrows when the handler fails, so pg-boss retries the job", async () => {
    const dbError = new Error("connection lost");
    // @ts-expect-error missing vitest type
    db.assetReminder.findFirst.mockRejectedValue(dbError);

    await expect(
      workerHandler(buildJob({ retrycount: 0, retrylimit: 2 }))
    ).rejects.toThrow("connection lost");
  });

  it("does not log on an intermediate retry attempt (noise control)", async () => {
    const dbError = new Error("connection lost");
    // @ts-expect-error missing vitest type
    db.assetReminder.findFirst.mockRejectedValue(dbError);

    // pg-boss increments retrycount at fetch time, so with retrylimit 2 the
    // handler observes retrycount 0, 1, 2 — the final attempt is retrycount
    // === retrylimit (2). retrycount 1 is an intermediate retry: it should
    // still rethrow (so pg-boss retries again) but must NOT log yet.
    await expect(
      workerHandler(buildJob({ retrycount: 1, retrylimit: 2 }))
    ).rejects.toThrow();

    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("logs once on the final retry attempt before rethrowing", async () => {
    const dbError = new Error("connection lost");
    // @ts-expect-error missing vitest type
    db.assetReminder.findFirst.mockRejectedValue(dbError);

    // retrycount 2 of retrylimit 2 → this IS the true final attempt, since
    // pg-boss's retrycount reaches retrylimit (not retrylimit - 1) on the
    // last try.
    await expect(
      workerHandler(buildJob({ retrycount: 2, retrylimit: 2 }))
    ).rejects.toThrow();

    expect(Logger.error).toHaveBeenCalledOnce();
  });
});
