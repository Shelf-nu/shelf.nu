/**
 * Link preview queue worker
 *
 * Registers the pg-boss worker for `QueueNames.linkPreviewQueue` and runs
 * `runLinkPreviewJob` for each claimed link. Jobs are queued with
 * `retryLimit: 0` (retries are scheduled through `LinkPreview.nextFetchAt`),
 * so a failing job is logged and rethrown once.
 *
 * @see {@link file://./service.server.ts} what each job does
 * @see {@link file://../../entry.server.tsx} where the worker is registered
 */
import type PgBoss from "pg-boss";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { runLinkPreviewJob } from "./service.server";
import type { LinkPreviewJob } from "./service.server";

/**
 * Titles show on the next page load, so the worker polls every five seconds
 * rather than at the scheduler default of five minutes. Four jobs at a time
 * per instance is also the cap on outbound page fetches.
 */
const LINK_PREVIEW_WORKER_OPTIONS = {
  newJobCheckIntervalSeconds: 5,
  teamSize: 4,
  teamConcurrency: 4,
} as const;

/**
 * Handles one pg-boss job: runs it, and on failure logs and rethrows so
 * pg-boss marks the job failed.
 *
 * @param job - The queued job
 * @throws The job failure, after logging it
 */
async function handleLinkPreviewJob(job: PgBoss.Job<LinkPreviewJob>) {
  try {
    await runLinkPreviewJob(job.data);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Link preview job failed",
        additionalData: {
          previewId: job.data.previewId,
          organizationId: job.data.organizationId,
        },
        label: "Link preview",
      })
    );
    throw cause;
  }
}

/**
 * Registers the link preview queue worker. Call once at server start, after
 * the scheduler is initialised.
 */
export async function registerLinkPreviewWorkers() {
  await scheduler.work<LinkPreviewJob>(
    QueueNames.linkPreviewQueue,
    LINK_PREVIEW_WORKER_OPTIONS,
    handleLinkPreviewJob
  );
}
