/**
 * Asset import queue producer.
 *
 * Sends one pg-boss job per import step. Every job carries a singleton key
 * derived from the import and the step, so sending the same step twice while
 * the first is still queued is a no-op.
 *
 * @see {@link file://./constants.ts}
 * @see {@link file://./service.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { ASSET_IMPORT_JOB_OPTIONS } from "./constants";
import type { AssetImportJobData } from "./types";

/**
 * Singleton key for a step: one queued job per import and step.
 *
 * @param data - The step payload
 * @returns The pg-boss singleton key
 */
function singletonKeyFor(data: AssetImportJobData): string {
  switch (data.step) {
    case "PREPARE":
      return `${data.importId}:PREPARE`;
    case "ROWS":
      return `${data.importId}:ROWS:${data.chunkIndex}`;
    case "FINALIZE":
      return `${data.importId}:FINALIZE`;
  }
}

/**
 * Queues one import step.
 *
 * pg-boss returns null when a job with the same singleton key is already
 * queued; that means the step is already scheduled, so it counts as success.
 *
 * @param data - Import id and the step to run
 * @throws {ShelfError} When the queue rejects the job
 */
export async function enqueueAssetImportStep(
  data: AssetImportJobData
): Promise<void> {
  const singletonKey = singletonKeyFor(data);

  try {
    const jobId = await scheduler.send(QueueNames.assetImportQueue, data, {
      ...ASSET_IMPORT_JOB_OPTIONS,
      singletonKey,
    });

    if (jobId === null) {
      Logger.info(
        `Asset import step already queued, skipping send (${singletonKey})`
      );
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to queue the asset import step",
      additionalData: { ...data, singletonKey },
      label: "Asset Import",
    });
  }
}
