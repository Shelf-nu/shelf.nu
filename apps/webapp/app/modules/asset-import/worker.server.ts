/**
 * Asset import job runner
 *
 * A confirmed import runs as a chain of pg-boss jobs on one queue: PREPARE,
 * then one ROWS job per chunk of `ASSET_IMPORT_CHUNK_SIZE` rows, then
 * FINALIZE. Each job runs one step and queues the next, so a single job never
 * holds a process for long and a crash loses at most one chunk's work, which
 * the retried job redoes.
 *
 * - Every job carries a singleton key derived from the import and the step,
 *   so sending a step that is already queued is a no-op.
 * - A step runs only while it holds the import's lease (`lease.server.ts`). A
 *   duplicate job that cannot claim it returns quietly: the run holding the
 *   lease continues the chain.
 * - A step that throws is retried by pg-boss. Only the last attempt marks the
 *   import FAILED, with a message the user can act on, and the user can then
 *   resume it from the rows already written.
 *
 * @see {@link file://./constants.ts} chunk size, lease and retry settings
 * @see {@link file://./prepare.server.ts}
 * @see {@link file://./chunk-writer.server.ts}
 * @see {@link file://./finalize.server.ts}
 * @see {@link file://./service.server.ts} confirm and resume, which queue PREPARE
 */
import type { AssetImport, AssetImportStatus } from "@prisma/client";
import { LRUCache } from "lru-cache";
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { MAX_CACHE_SIZE } from "~/utils/import.image-cache.server";
import type { CachedImage } from "~/utils/import.image-cache.server";
import { Logger } from "~/utils/logger";
import { isValidImageUrl } from "~/utils/misc";
import { threeDaysFromNow } from "~/utils/one-week-from-now";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { createSignedUrl, uploadImageFromUrl } from "~/utils/storage.server";
import type { ImportedImage } from "./chunk-writer.server";
import { writeImportChunk } from "./chunk-writer.server";
import {
  ASSET_IMPORT_CHUNK_SIZE,
  ASSET_IMPORT_IMAGE_BUDGET_MS,
  ASSET_IMPORT_JOB_OPTIONS,
  ASSET_IMPORT_POLL_INTERVAL_SECONDS,
} from "./constants";
import { markImportFailed } from "./failure.server";
import { runFinalizeStep } from "./finalize.server";
import type { ImportLeaseArgs } from "./lease.server";
import { claimImportLease, releaseImportLease } from "./lease.server";
import { runPrepareStep, userCanStillImport } from "./prepare.server";
import { nextStepAfter, resolvedOf, storedRowsOf } from "./progress.server";
import type {
  AssetImportJobData,
  ImportWarning,
  StoredImportRow,
} from "./types";

const label = "Asset Import";

/** Shown when a step fails for a reason the user cannot act on. */
export const IMPORT_FAILED_MESSAGE =
  "Something went wrong while importing. Your progress is saved, use Resume to continue.";

/** Shown when the user who started the import may no longer import. */
export const IMPORT_PERMISSION_LOST_MESSAGE =
  "You no longer have permission to import assets in this workspace.";

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
      label,
    });
  }
}

/**
 * Whether a step may run on an import in this status. PREPARE starts a QUEUED
 * import (or redoes a RUNNING one on retry); ROWS and FINALIZE need PREPARE to
 * have run, so they only run on a RUNNING import. A job for any other status
 * is stale: a resumed import starts again from PREPARE.
 *
 * @param status - The import's status
 * @param step - The step the job asks for
 */
function stepCanRun(
  status: AssetImportStatus,
  step: AssetImportJobData["step"]
): boolean {
  if (step === "PREPARE") return status === "QUEUED" || status === "RUNNING";
  return status === "RUNNING";
}

/**
 * The message stored on an import that failed for good: the error's own
 * message when it is a user error, otherwise a generic one.
 *
 * @param cause - What the step threw
 * @returns A message the user can read
 */
function userFacingMessage(cause: unknown): string {
  if (isLikeShelfError(cause) && (cause.status ?? 500) < 500 && cause.message) {
    return cause.message;
  }
  return IMPORT_FAILED_MESSAGE;
}

/** Images of one chunk, and a warning per row whose image was left out. */
type ChunkImages = {
  /** Signed image per asset id. */
  images: Record<string, ImportedImage>;
  /** One warning per row imported without its image. */
  warnings: ImportWarning[];
};

/**
 * Warning for a row whose image could not be downloaded or stored.
 *
 * @param row - The row
 * @param imageUrl - The image cell
 */
function imageFailedWarning(
  row: StoredImportRow,
  imageUrl: string
): ImportWarning {
  return {
    row: row.rowNumber,
    title: row.title,
    message: `Image "${imageUrl}" could not be downloaded; the asset was imported without an image.`,
  };
}

/**
 * Warning for a row whose image was not attempted because the chunk's image
 * time budget ran out.
 *
 * @param row - The row
 */
function imageSkippedWarning(row: StoredImportRow): ImportWarning {
  return {
    row: row.rowNumber,
    title: row.title,
    message:
      "The image was skipped because the import ran out of time for images; the asset was imported without an image.",
  };
}

/**
 * Downloads, stores and signs the main image of every row in a chunk that has
 * an image URL. Runs before the chunk's transaction so the transaction never
 * waits on the network. The storage path depends only on the creator and the
 * pre-allocated asset id, and uploads overwrite, so a retried chunk replaces
 * its own images instead of leaving extra copies.
 *
 * The step must finish well inside the job expiry, so:
 * - a URL that failed once in the chunk is not fetched again (an unreachable
 *   host costs about 20 seconds per attempt);
 * - the whole image phase is capped at `ASSET_IMPORT_IMAGE_BUDGET_MS`; rows
 *   not reached in time are imported without an image.
 *
 * Every row left without its image (invalid URL, failed download or upload,
 * budget spent) gets a warning, so the user can see which images to add.
 *
 * @param args.rows - The chunk's rows
 * @param args.userId - The user who started the import
 * @param args.lease - The import the chunk belongs to, for log context
 * @returns The signed images and the warnings for rows without one
 */
async function uploadChunkImages({
  rows,
  userId,
  lease,
}: {
  rows: StoredImportRow[];
  userId: string;
  lease: ImportLeaseArgs;
}): Promise<ChunkImages> {
  const images: Record<string, ImportedImage> = {};
  const warnings: ImportWarning[] = [];
  // Files often repeat one image URL across many rows; the cache downloads it
  // once per chunk, and `failedUrls` does the same for URLs that fail.
  const cache = new LRUCache<string, CachedImage>({
    maxSize: MAX_CACHE_SIZE,
    sizeCalculation: (value) =>
      typeof value?.size === "number" && value.size > 0 ? value.size : 1,
  });
  const failedUrls = new Set<string>();
  const deadline = Date.now() + ASSET_IMPORT_IMAGE_BUDGET_MS;

  for (const row of rows) {
    const imageUrl = row.imageUrl?.trim();
    if (!imageUrl) continue;

    if (!isValidImageUrl(imageUrl) || failedUrls.has(imageUrl)) {
      warnings.push(imageFailedWarning(row, imageUrl));
      continue;
    }

    if (Date.now() >= deadline) {
      warnings.push(imageSkippedWarning(row));
      continue;
    }

    try {
      const path = await uploadImageFromUrl(
        imageUrl,
        {
          filename: `${userId}/${row.assetId}/main-image-import`,
          contentType: "image/jpeg",
          bucketName: "assets",
          resizeOptions: { width: 1200, withoutEnlargement: true },
        },
        cache
      );
      if (path) {
        images[row.assetId] = {
          mainImage: await createSignedUrl({ filename: path }),
          mainImageExpiration: threeDaysFromNow(),
        };
      } else {
        // `uploadImageFromUrl` returns null when the download failed.
        failedUrls.add(imageUrl);
        warnings.push(imageFailedWarning(row, imageUrl));
      }
    } catch (cause) {
      failedUrls.add(imageUrl);
      warnings.push(imageFailedWarning(row, imageUrl));
      Logger.error(
        new ShelfError({
          cause,
          message: `Image could not be imported for asset "${row.title}"`,
          additionalData: { imageUrl, assetId: row.assetId, ...lease },
          label,
          shouldBeCaptured: false,
        })
      );
    }
  }

  return { images, warnings };
}

/**
 * Runs one ROWS chunk for an import the caller holds the lease on.
 *
 * A chunk that does not start at `processedRows` is not written: when it is
 * behind, it was committed by an earlier attempt; when it is ahead, an earlier
 * chunk is still missing. Either way the chain continues from the import's
 * real progress. Images are uploaded only for a chunk that is about to be
 * written.
 *
 * @param assetImport - The import as loaded by the job runner
 * @param chunkIndex - Which chunk to write
 * @returns The step to queue next
 * @throws {ShelfError} When the chunk cannot be written
 */
export async function runRowsStep(
  assetImport: AssetImport,
  chunkIndex: number
): Promise<AssetImportJobData> {
  const {
    id: importId,
    organizationId,
    createdById: userId,
    processedRows,
    totalRows,
  } = assetImport;
  const chunkStart = chunkIndex * ASSET_IMPORT_CHUNK_SIZE;

  if (chunkStart !== processedRows) {
    return nextStepAfter({ importId, processedRows, totalRows });
  }

  const rows = storedRowsOf(assetImport).slice(
    chunkStart,
    chunkStart + ASSET_IMPORT_CHUNK_SIZE
  );
  const resolved = resolvedOf(assetImport);
  const { images: imagePaths, warnings: imageWarnings } =
    await uploadChunkImages({
      rows,
      userId,
      lease: { importId, organizationId },
    });

  const result = await writeImportChunk({
    importId,
    organizationId,
    userId,
    rows,
    chunkStart,
    resolved,
    canUseBarcodes: assetImport.canUseBarcodes,
    imagePaths,
    extraWarnings: imageWarnings,
  });

  return nextStepAfter({
    importId,
    processedRows: result.nextProcessedRows,
    totalRows,
  });
}

/**
 * Whether pg-boss will not retry this job again if it throws.
 *
 * @param job - The running job
 */
function isLastAttempt(job: PgBoss.JobWithMetadata<AssetImportJobData>) {
  return (
    job.retrycount != null &&
    job.retrylimit != null &&
    job.retrycount >= job.retrylimit
  );
}

/**
 * Runs one import step. Exported for tests; pg-boss calls it through
 * {@link registerAssetImportWorkers}.
 *
 * Loading the import and claiming its lease run inside the same error handling
 * as the step, so a failure there on the last attempt still marks the import
 * FAILED. When the import cannot be loaded at all there is nothing to mark: the
 * error is logged and rethrown, and stall detection fails the import later.
 *
 * The lease is released before the next step is queued, so the next job can
 * never find it still held and drop out of the chain. A step that throws
 * releases it in `finally`.
 *
 * @param job - The pg-boss job, with retry metadata
 * @throws The step's error, so pg-boss retries it or records the failure
 */
export async function handleAssetImportJob(
  job: PgBoss.JobWithMetadata<AssetImportJobData>
): Promise<void> {
  const { data } = job;
  const { importId } = data;
  // Set once the import is loaded; the failure path needs its workspace. It is
  // asserted rather than annotated so the catch and finally blocks see the
  // full type instead of the `null` it starts as.
  let lease = null as ImportLeaseArgs | null;
  let leaseHeld = false;

  try {
    const assetImport = await db.assetImport.findFirst({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: background pg-boss job; the id comes from our own job payload (queued by confirm, resume or a previous step), never from a request. Every later write is scoped by the organizationId read here.
      where: { id: importId },
    });

    if (!assetImport || !stepCanRun(assetImport.status, data.step)) {
      Logger.info(
        `Skipping asset import ${
          data.step
        } job for import ${importId} (status ${
          assetImport?.status ?? "missing"
        })`
      );
      return;
    }

    const { organizationId } = assetImport;
    const importLease: ImportLeaseArgs = { importId, organizationId };
    lease = importLease;

    if (!(await claimImportLease(importLease))) {
      // Another run is alive and continues the chain. Returning instead of
      // throwing keeps this duplicate from using up retries and failing the
      // import.
      Logger.info(
        `Asset import ${importId} is held by another run, skipping ${data.step}`
      );
      return;
    }
    leaseHeld = true;

    /** Releases the lease, then queues the next step (if any). */
    const handOff = async (next: AssetImportJobData | null) => {
      leaseHeld = false;
      await releaseImportLease(importLease);
      if (next) await enqueueAssetImportStep(next);
    };

    switch (data.step) {
      case "PREPARE": {
        const allowed = await userCanStillImport({
          userId: assetImport.createdById,
          organizationId,
        });
        if (!allowed) {
          await markImportFailed({
            importId,
            organizationId,
            errorMessage: IMPORT_PERMISSION_LOST_MESSAGE,
          });
          return;
        }
        await handOff(await runPrepareStep(assetImport));
        return;
      }
      case "ROWS":
        await handOff(await runRowsStep(assetImport, data.chunkIndex));
        return;
      case "FINALIZE":
        if (assetImport.processedRows < assetImport.totalRows) {
          // Rows are still missing, so this job is stale; continue from the
          // import's real progress instead of completing it early.
          await handOff(
            nextStepAfter({
              importId,
              processedRows: assetImport.processedRows,
              totalRows: assetImport.totalRows,
            })
          );
          return;
        }
        await runFinalizeStep(assetImport);
        return;
    }
  } catch (cause) {
    if (isLastAttempt(job)) {
      const organizationId = lease?.organizationId;
      if (organizationId) {
        try {
          await markImportFailed({
            importId,
            organizationId,
            errorMessage: userFacingMessage(cause),
          });
        } catch (markCause) {
          Logger.error(
            new ShelfError({
              cause: markCause,
              message: "Failed to mark the asset import as failed",
              additionalData: { ...data, organizationId },
              label,
            })
          );
        }
      }
      Logger.error(
        new ShelfError({
          cause,
          message: `Asset import ${data.step} step failed after its last retry`,
          additionalData: { ...data, organizationId },
          label,
        })
      );
    }
    throw cause;
  } finally {
    if (leaseHeld && lease) await releaseImportLease(lease);
  }
}

/**
 * Starts polling the asset import queue. Called once at server start.
 *
 * Two jobs run at a time per process, one per worker; different imports run
 * in parallel and the lease keeps two steps of one import apart.
 */
export async function registerAssetImportWorkers(): Promise<void> {
  await scheduler.work<AssetImportJobData>(
    QueueNames.assetImportQueue,
    {
      newJobCheckIntervalSeconds: ASSET_IMPORT_POLL_INTERVAL_SECONDS,
      teamSize: 2,
      teamConcurrency: 1,
      includeMetadata: true,
    },
    handleAssetImportJob
  );
}
