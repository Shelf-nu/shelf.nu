/**
 * Push queue worker
 *
 * Registers the pg-boss worker for `QueueNames.pushQueue` and hands each job
 * to the push service by kind: `send` runs `deliverPush`, `receipts` runs
 * `checkPushReceipts`.
 *
 * A failing job is logged on its last attempt only and always rethrown, so
 * pg-boss retries it within the `retryLimit` set when it was queued.
 *
 * @see {@link file://./service.server.ts} what each job does
 * @see {@link file://../../entry.server.tsx} where the worker is registered
 */
import type PgBoss from "pg-boss";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { ShelfError } from "~/utils/error";
import { isLastAttempt } from "~/utils/job-retry";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { checkPushReceipts, deliverPush } from "./service.server";
import type { PushJob } from "./types";

/**
 * Pushes are only useful while fresh, so the worker polls every five seconds
 * rather than at the scheduler default of five minutes. pg-boss 9 waits out
 * the rest of the interval after every fetch, even when more jobs are queued,
 * so one instance runs at most 10 jobs per 5 seconds, 5 at a time.
 */
const PUSH_WORKER_OPTIONS = {
  newJobCheckIntervalSeconds: 5,
  teamSize: 10,
  teamConcurrency: 5,
  includeMetadata: true,
} as const;

/** Runs one push job. */
function runPushJob(job: PushJob): Promise<void> {
  switch (job.kind) {
    case "send":
      return deliverPush(job);
    case "receipts":
      return checkPushReceipts(job);
    default:
      checkExhaustiveSwitch(job);
      throw new ShelfError({
        cause: null,
        message: "Unknown push job kind.",
        additionalData: { kind: String((job as { kind: unknown }).kind) },
        label: "Push",
      });
  }
}

/**
 * Handles one pg-boss job: runs it, and on failure logs on the last attempt
 * and rethrows so pg-boss retries.
 *
 * @param job - The job with retry metadata
 * @throws The job failure, after logging it on the last attempt
 */
async function handlePushJob(job: PgBoss.JobWithMetadata<PushJob>) {
  try {
    await runPushJob(job.data);
  } catch (cause) {
    if (isLastAttempt(job)) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Push job failed after exhausting all retries",
          additionalData: {
            kind: job.data.kind,
            ...(job.data.kind === "send" && {
              organizationId: job.data.message.organizationId,
              category: job.data.message.category,
            }),
            retryCount: job.retrycount,
            retryLimit: job.retrylimit,
          },
          label: "Push",
        })
      );
    }

    throw cause;
  }
}

/**
 * Registers the push queue worker. Call once at server start, after the
 * scheduler is initialised.
 */
export async function registerPushWorkers() {
  await scheduler.work<PushJob>(
    QueueNames.pushQueue,
    PUSH_WORKER_OPTIONS,
    handlePushJob
  );
}
