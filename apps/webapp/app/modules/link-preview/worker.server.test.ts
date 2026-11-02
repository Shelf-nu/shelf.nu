/**
 * Tests for the link preview queue worker.
 *
 * Checks the registration pg-boss sees (queue name and polling options) and
 * exercises the registered callback as pg-boss would call it: a job runs
 * `runLinkPreviewJob` with its data, and a failing job is logged with the
 * link's row and workspace, then rethrown so pg-boss marks it failed.
 *
 * @see {@link file://./worker.server.ts}
 */
import type PgBoss from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { runLinkPreviewJob } from "./service.server";
import type { LinkPreviewJob } from "./service.server";
import { registerLinkPreviewWorkers } from "./worker.server";

// @vitest-environment node

// why: pg-boss needs a live Postgres; `work` captures the registered callback
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { linkPreviewQueue: "link-preview-queue" },
  scheduler: { work: vi.fn() },
}));

// why: the job itself (database reads and the page fetch) has its own suite;
// here only the worker's handling of its outcome is under test
vi.mock("./service.server", () => ({
  runLinkPreviewJob: vi.fn(),
}));

// why: spying on Logger to assert the failure log without pino or Sentry
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Handler = (job: PgBoss.Job<LinkPreviewJob>) => Promise<void>;

const job = {
  id: "job-1",
  name: "link-preview-queue",
  data: { previewId: "preview-1", organizationId: "org-1" },
} as PgBoss.Job<LinkPreviewJob>;

/** Registers the worker and returns the callback it handed to pg-boss. */
async function registeredHandler(): Promise<Handler> {
  await registerLinkPreviewWorkers();
  return vi.mocked(scheduler.work).mock.calls[0][2] as unknown as Handler;
}

describe("registerLinkPreviewWorkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("works the link preview queue, polling every 5 s, 4 jobs at a time", async () => {
    await registerLinkPreviewWorkers();

    expect(scheduler.work).toHaveBeenCalledWith(
      QueueNames.linkPreviewQueue,
      { newJobCheckIntervalSeconds: 5, teamSize: 4, teamConcurrency: 4 },
      expect.any(Function)
    );
  });

  it("runs the job with its data", async () => {
    vi.mocked(runLinkPreviewJob).mockResolvedValue(undefined);
    const handle = await registeredHandler();

    await handle(job);

    expect(runLinkPreviewJob).toHaveBeenCalledWith(job.data);
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("logs a failing job with its row and workspace, then rethrows", async () => {
    const failure = new Error("database down");
    vi.mocked(runLinkPreviewJob).mockRejectedValue(failure);
    const handle = await registeredHandler();

    await expect(handle(job)).rejects.toBe(failure);
    expect(vi.mocked(Logger.error).mock.calls[0][0]).toMatchObject({
      message: "Link preview job failed",
      additionalData: { previewId: "preview-1", organizationId: "org-1" },
    });
  });
});
